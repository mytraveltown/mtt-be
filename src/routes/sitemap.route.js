const router = require("express").Router();
const sitemapController = require("../controllers/sitemap.controller");

router.get("/packages.xml", sitemapController.getPackagesSitemap);

module.exports = router;
