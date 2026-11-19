const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const mediaController = require("../controllers/media.controller");

// Listing pages load many images at once, so this is generous; signing is local and cheap.
const mediaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later.", data: null },
});

router.get("/*key", mediaLimiter, mediaController.redirect);

// Mounted on /uploads before the static folder: S3 copy first, local file as fallback.
const legacyUploadsRouter = require("express").Router();
legacyUploadsRouter.get("/*file", mediaLimiter, mediaController.legacyRedirect);

module.exports = router;
module.exports.legacyUploadsRouter = legacyUploadsRouter;
