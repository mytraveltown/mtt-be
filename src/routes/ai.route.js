const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const aiController = require("../controllers/ai.controller");
const auth = require("../middlewares/auth.middleware");

// Each call costs an AI request, so cap it per signed-in user.
const refineTextLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: { success: false, message: "Too many AI requests. Please try again later.", data: null },
});

router.post("/refine-text", auth, refineTextLimiter, aiController.refineText);

module.exports = router;
