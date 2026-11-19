const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const reviewController = require("../controllers/review.controller");
const reviewPromptController = require("../controllers/reviewPrompt.controller");
const auth = require("../middlewares/auth.middleware");
const formFields = require("../middlewares/formFields.middleware");

// Cap submissions per IP on top of the booking/ownership checks in the controller.
const createReviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many reviews submitted. Please try again later." },
});

const createReplyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many replies posted. Please try again later." },
});

// The prompt is checked once per site visit; this only guards against runaway clients.
const reviewPromptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later.", data: null },
});

// Post-trip "rate your trip" prompt for the logged-in traveller.
router.get("/prompt", reviewPromptLimiter, auth, reviewPromptController.getPending);
router.post("/prompt/:bookingId/seen", reviewPromptLimiter, auth, reviewPromptController.markSeen);
router.post("/prompt/:bookingId/dismiss", reviewPromptLimiter, auth, reviewPromptController.dismiss);

// Reviews are visible to logged-in users only.
router.get("/package/:packageId", auth, reviewController.getByPackage);
// Single review, used to deep-link to a review that is not on the first page.
router.get("/:id", auth, reviewController.getById);
// Only users with a paid booking for the package may review it (checked in the controller).
router.post(
  "/package/:packageId",
  createReviewLimiter,
  auth,
  formFields,
  reviewController.create
);
router.delete("/:id", auth, reviewController.remove);
// Only admins and the agent who owns the package may reply (checked in the controller).
router.post("/:id/replies", createReplyLimiter, auth, reviewController.createReply);
router.delete("/replies/:replyId", auth, reviewController.removeReply);

module.exports = router;
