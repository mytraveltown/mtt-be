const db = require("../config/db");

/**
 * The travel partner's bell feed: reviews on their packages and paid bookings, newest first.
 * An item is unread while it is newer than the agent's seen timestamp for its type
 * (`reviews_seen_at` / `bookings_seen_at`; NULL = never seen).
 * Both sources share one column shape so they can be merged and paginated in SQL.
 */
const REVIEW_FEED_SQL = `
  SELECT 'review' AS type, r.id AS ref_id, r.created_at AS event_at,
         p.id AS package_id, p.slug AS package_slug, p.package_name,
         COALESCE(u.name, r.guest_name) AS actor_name, u.profile AS actor_profile,
         r.rating,
         EXISTS (
           SELECT 1 FROM package_review_reply rr
           WHERE rr.review_id = r.id AND rr.user_id = a.user_id
         ) AS has_replied,
         NULL AS travel_date, NULL AS guests, NULL AS amount,
         (a.reviews_seen_at IS NULL OR r.created_at > a.reviews_seen_at) AS is_unread
  FROM package_review r
  JOIN travel_package p ON p.id = r.package_id
  JOIN agent a ON a.id = p.agent_id
  LEFT JOIN users u ON u.id = r.user_id
  WHERE a.id = ? AND (r.user_id IS NULL OR r.user_id <> a.user_id)`;

const BOOKING_FEED_SQL = `
  SELECT 'booking' AS type, b.id AS ref_id, COALESCE(b.paid_at, b.created_at) AS event_at,
         p.id AS package_id, p.slug AS package_slug, p.package_name,
         b.name AS actor_name, u.profile AS actor_profile,
         NULL AS rating, NULL AS has_replied,
         DATE_FORMAT(b.travel_date, '%Y-%m-%d') AS travel_date, b.guests, b.amount,
         (a.bookings_seen_at IS NULL OR COALESCE(b.paid_at, b.created_at) > a.bookings_seen_at) AS is_unread
  FROM bookings b
  JOIN travel_package p ON p.id = b.package_id
  JOIN agent a ON a.id = p.agent_id
  LEFT JOIN users u ON u.id = b.user_id
  WHERE a.id = ? AND b.payment_status = 'paid'`;

const SEEN_COLUMN_BY_TYPE = { review: "reviews_seen_at", booking: "bookings_seen_at" };

const FEED_BY_TYPE = { review: REVIEW_FEED_SQL, booking: BOOKING_FEED_SQL };
const NOTIFICATION_TYPES = Object.keys(FEED_BY_TYPE);

/** The feed for one type, or both merged when `type` is null. Each part takes the agent id once. */
const buildFeed = (type, agentId) => {
  const parts = type ? [FEED_BY_TYPE[type]] : NOTIFICATION_TYPES.map((t) => FEED_BY_TYPE[t]);
  return { sql: parts.join("\n  UNION ALL\n"), params: parts.map(() => agentId) };
};

const toItem = (row) => {
  const base = {
    type: row.type,
    id: `${row.type}-${row.ref_id}`,
    ref_id: row.ref_id,
    created_at: row.event_at,
    package_id: row.package_id,
    package_slug: row.package_slug,
    package_name: row.package_name,
    actor_name: row.actor_name,
    actor_profile: row.actor_profile,
    is_unread: Boolean(row.is_unread),
  };
  if (row.type === "review") {
    return { ...base, rating: row.rating, has_replied: Boolean(row.has_replied) };
  }
  return { ...base, travel_date: row.travel_date, guests: row.guests, amount: Number(row.amount) };
};

class AgentNotification {
  /** `type` is "review", "booking" or null for both. */
  static async findByAgent(agent, { type = null, limit, offset }) {
    const feed = buildFeed(type, agent.id);
    const [rows] = await db.query(
      `SELECT feed.* FROM (${feed.sql}) feed
       ORDER BY feed.event_at DESC, feed.ref_id DESC
       LIMIT ? OFFSET ?`,
      [...feed.params, limit, offset]
    );
    return rows.map(toItem);
  }

  /** Total and unread counts for each type, e.g. { review: { total, unread }, booking: { ... } }. */
  static async countByAgent(agent) {
    const feed = buildFeed(null, agent.id);
    const [rows] = await db.query(
      `SELECT feed.type, COUNT(*) AS total, COALESCE(SUM(feed.is_unread), 0) AS unread
       FROM (${feed.sql}) feed
       GROUP BY feed.type`,
      feed.params
    );
    const counts = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, { total: 0, unread: 0 }]));
    rows.forEach((row) => {
      counts[row.type] = { total: Number(row.total), unread: Number(row.unread) };
    });
    return counts;
  }

  /** Marks the given types (default: all) as seen up to now. Column names come from a fixed map, never input. */
  static async markSeen(agentId, types = NOTIFICATION_TYPES) {
    const assignments = types.map((type) => `${SEEN_COLUMN_BY_TYPE[type]} = NOW()`).join(", ");
    const [result] = await db.query(`UPDATE agent SET ${assignments} WHERE id = ?`, [agentId]);
    return result.affectedRows;
  }
}

module.exports = AgentNotification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
