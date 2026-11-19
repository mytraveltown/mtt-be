const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const uploadController = require("../controllers/upload.controller");
const auth = require("../middlewares/auth.middleware");

// A package gallery takes up to 20 files, plus retries; this only stops runaway clients.
const presignLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 150,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many uploads. Please try again later.", data: null },
});

router.post("/presign", presignLimiter, auth, uploadController.presign);

module.exports = router;
