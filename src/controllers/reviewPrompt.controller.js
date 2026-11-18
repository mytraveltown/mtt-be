const ReviewPrompt = require("../models/reviewPrompt.model");
const { todayIso } = require("../utils/bookingDates");

/**
 * Frequency rules that keep the post-trip review request polite:
 * shown from the last day of the trip, at most MAX_PROMPTS times per booking,
 * SNOOZE_DAYS apart, and never once the trip ended more than WINDOW_DAYS ago.
 */
const PROMPT_RULES = Object.freeze({
  maxPrompts: 3,
  snoozeDays: 3,
  windowDays: 30,
});

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// GET /api/reviews/prompt  -> the one trip to ask about now, or null
exports.getPending = async (req, res) => {
  try {
    const prompt = await ReviewPrompt.findPendingForUser(req.user.id, {
      today: todayIso(),
      windowDays: PROMPT_RULES.windowDays,
      maxPrompts: PROMPT_RULES.maxPrompts,
    });
    res.status(200).json({ success: true, message: "OK", data: prompt });
  } catch (err) {
    console.error("Review prompt lookup failed:", err);
    res.status(500).json({ success: false, message: "Server error", data: null });
  }
};

// POST /api/reviews/prompt/:bookingId/seen  -> counts the impression and snoozes the prompt
exports.markSeen = async (req, res) => {
  try {
    const bookingId = parseId(req.params.bookingId);
    if (!bookingId) {
      return res.status(400).json({ success: false, message: "Invalid booking id", data: null });
    }
    const updated = await ReviewPrompt.markShown(bookingId, req.user.id, PROMPT_RULES.snoozeDays);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Booking not found", data: null });
    }
    res.status(200).json({ success: true, message: "Review prompt snoozed", data: { booking_id: bookingId } });
  } catch (err) {
    console.error("Review prompt snooze failed:", err);
    res.status(500).json({ success: false, message: "Server error", data: null });
  }
};

// POST /api/reviews/prompt/:bookingId/dismiss  -> "Don't ask again" for this trip
exports.dismiss = async (req, res) => {
  try {
    const bookingId = parseId(req.params.bookingId);
    if (!bookingId) {
      return res.status(400).json({ success: false, message: "Invalid booking id", data: null });
    }
    const updated = await ReviewPrompt.dismiss(bookingId, req.user.id);
    if (!updated) {
      return res.status(404).json({ success: false, message: "Booking not found", data: null });
    }
    res.status(200).json({ success: true, message: "Review prompt dismissed", data: { booking_id: bookingId } });
  } catch (err) {
    console.error("Review prompt dismiss failed:", err);
    res.status(500).json({ success: false, message: "Server error", data: null });
  }
};
