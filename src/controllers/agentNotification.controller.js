const AgentNotification = require("../models/agentNotification.model");
const { NOTIFICATION_TYPES } = AgentNotification;
const Agent = require("../models/agent.model");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination");

const notAnAgent = (res) =>
  res.status(403).json({ success: false, message: "Only travel partners have notifications", data: null });

/** Reads the optional `type` query param; returns undefined when it is not a known type. */
const parseType = (query) => {
  if (!query.type) return null;
  const type = String(query.type);
  return NOTIFICATION_TYPES.includes(type) ? type : undefined;
};

const invalidType = (res) =>
  res.status(400).json({
    success: false,
    message: `type must be one of: ${NOTIFICATION_TYPES.join(", ")}`,
    data: null,
  });

// GET /api/agents/me/notifications?type=review|booking&page=&limit=
//   -> new reviews and/or paid bookings, the overall unread count and unread counts per type
exports.list = async (req, res) => {
  try {
    const type = parseType(req.query);
    if (type === undefined) return invalidType(res);

    const agent = await Agent.findByUserId(req.user.id);
    if (!agent) return notAnAgent(res);

    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 10, maxLimit: 50 });
    const [items, counts] = await Promise.all([
      AgentNotification.findByAgent(agent, { type, limit, offset }),
      AgentNotification.countByAgent(agent),
    ]);

    const unreadByType = Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t, counts[t].unread]));
    const sum = (field) => NOTIFICATION_TYPES.reduce((acc, t) => acc + counts[t][field], 0);
    const total = type ? counts[type].total : sum("total");

    res.status(200).json({
      success: true,
      message: "OK",
      data: {
        items,
        unread_count: sum("unread"),
        unread_by_type: unreadByType,
        pagination: buildPaginationMeta({ page, limit, total }),
      },
    });
  } catch (err) {
    console.error("Agent notifications lookup failed:", err);
    res.status(500).json({ success: false, message: "Server error", data: null });
  }
};

// POST /api/agents/me/notifications/read?type=review|booking  -> marks one type (or all) as seen up to now
exports.markAllRead = async (req, res) => {
  try {
    const type = parseType(req.query);
    if (type === undefined) return invalidType(res);

    const agent = await Agent.findByUserId(req.user.id);
    if (!agent) return notAnAgent(res);

    await AgentNotification.markSeen(agent.id, type ? [type] : NOTIFICATION_TYPES);
    res.status(200).json({ success: true, message: "Notifications marked as read", data: { type: type ?? "all" } });
  } catch (err) {
    console.error("Marking agent notifications read failed:", err);
    res.status(500).json({ success: false, message: "Server error", data: null });
  }
};
