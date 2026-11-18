const db = require("../config/db");

/** Last day of the trip: a 5-day package starting 10 Oct ends on 14 Oct. */
const TRIP_END_DATE_SQL = "DATE_ADD(b.travel_date, INTERVAL GREATEST(p.days, 1) - 1 DAY)";

class ReviewPrompt {
  /**
   * The most recent trip the user should be asked to review, or null.
   * Eligible: own paid, non-cancelled booking whose last day is between `today - windowDays`
   * and `today`, package not yet reviewed by the user, not dismissed, not snoozed,
   * and asked fewer than `maxPrompts` times.
   */
  static async findPendingForUser(userId, { today, windowDays, maxPrompts }) {
    const [[row]] = await db.query(
      `SELECT b.id AS booking_id, b.package_id,
              DATE_FORMAT(b.travel_date, '%Y-%m-%d') AS travel_date,
              p.package_name, p.slug AS package_slug, p.days,
              DATE_FORMAT(${TRIP_END_DATE_SQL}, '%Y-%m-%d') AS trip_end_date
       FROM bookings b
       JOIN travel_package p ON p.id = b.package_id
       WHERE b.user_id = ?
         AND b.payment_status = 'paid'
         AND b.status <> 'cancelled'
         AND p.status = 'published'
         AND b.review_prompt_dismissed_at IS NULL
         AND b.review_prompt_count < ?
         AND (b.review_prompt_next_at IS NULL OR b.review_prompt_next_at <= NOW())
         AND ${TRIP_END_DATE_SQL} BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?
         AND NOT EXISTS (
           SELECT 1 FROM package_review r
           WHERE r.user_id = b.user_id AND r.package_id = b.package_id
         )
       ORDER BY ${TRIP_END_DATE_SQL} DESC, b.id DESC
       LIMIT 1`,
      [userId, maxPrompts, today, windowDays, today]
    );
    return row || null;
  }

  /** Records that the prompt was shown and hides it until `snoozeDays` have passed. */
  static async markShown(bookingId, userId, snoozeDays) {
    const [result] = await db.query(
      `UPDATE bookings
       SET review_prompt_count = review_prompt_count + 1,
           review_prompt_next_at = DATE_ADD(NOW(), INTERVAL ? DAY)
       WHERE id = ? AND user_id = ? AND review_prompt_dismissed_at IS NULL`,
      [snoozeDays, bookingId, userId]
    );
    return result.affectedRows > 0;
  }

  /** The user chose "Don't ask again" for this trip. */
  static async dismiss(bookingId, userId) {
    const [result] = await db.query(
      `UPDATE bookings
       SET review_prompt_dismissed_at = COALESCE(review_prompt_dismissed_at, NOW())
       WHERE id = ? AND user_id = ?`,
      [bookingId, userId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = ReviewPrompt;
