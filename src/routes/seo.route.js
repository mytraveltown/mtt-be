const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const seoController = require("../controllers/seo.controller");

// Every package page visit passes through here, so the limit is generous: it only stops floods.
const seoPageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

router.get("/package/:idOrSlug", seoPageLimiter, seoController.renderPackagePage);

module.exports = router;
