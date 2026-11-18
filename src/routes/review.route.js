const fs = require("fs");
const path = require("path");
const router = require("express").Router();
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const reviewController = require("../controllers/review.controller");
const reviewPromptController = require("../controllers/reviewPrompt.controller");
const auth = require("../middlewares/auth.middleware");

const MAX_MEDIA_FILES = 5;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_MEDIA = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

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

const uploadDir = path.join(__dirname, "../../uploads/reviews");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `review_${req.user.id}_${Date.now()}_${Math.round(Math.random() * 1e5)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_MEDIA_FILES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MEDIA[ext] && ALLOWED_MEDIA[ext] === file.mimetype) return cb(null, true);
    cb(new Error("Only JPG, PNG, WEBP images or MP4, MOV, WEBM videos are allowed"));
  },
});

const handleMediaUpload = (req, res, next) => {
  upload.array("media", MAX_MEDIA_FILES)(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Each file must be 25 MB or smaller"
          : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE"
            ? `You can upload up to ${MAX_MEDIA_FILES} files`
            : err.message;
      return res.status(400).json({ message });
    }
    next();
  });
};

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
  handleMediaUpload,
  reviewController.create
);
router.delete("/:id", auth, reviewController.remove);
// Only admins and the agent who owns the package may reply (checked in the controller).
router.post("/:id/replies", createReplyLimiter, auth, reviewController.createReply);
router.delete("/replies/:replyId", auth, reviewController.removeReply);

module.exports = router;
