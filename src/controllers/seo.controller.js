const fs = require("fs/promises");
const TravelPackage = require("../models/package.model");
const { buildPackageSeo, injectSeoTags } = require("../utils/seoHtml");

const DEFAULT_SITE_URL = "https://mytraveltown.com";
const DEFAULT_INDEX_PATH = "/var/www/html/index.html";

const getSiteUrl = () => (process.env.FRONTEND_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
const getIndexPath = () => process.env.FRONTEND_INDEX_PATH || DEFAULT_INDEX_PATH;

// The built index.html only changes on a frontend deploy, so it is re-read only when its mtime changes.
let templateCache = { path: null, mtimeMs: 0, html: "" };

const readIndexTemplate = async () => {
  const indexPath = getIndexPath();
  const { mtimeMs } = await fs.stat(indexPath);
  if (templateCache.path !== indexPath || templateCache.mtimeMs !== mtimeMs) {
    templateCache = { path: indexPath, mtimeMs, html: await fs.readFile(indexPath, "utf8") };
  }
  return templateCache.html;
};

const sendHtml = (res, status, html) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  // index.html points at hashed bundles that are replaced on every deploy, so never cache it.
  res.set("Cache-Control", "no-cache");
  res.status(status).send(html);
};

// GET /api/seo/package/:idOrSlug
// Apache forwards /package/:idOrSlug here so link previews (WhatsApp, Facebook, LinkedIn, X),
// which do not run JavaScript, get the package title and description in the initial HTML.
exports.renderPackagePage = async (req, res) => {
  let template;
  try {
    template = await readIndexTemplate();
  } catch (err) {
    console.error(`SEO: cannot read frontend index.html at ${getIndexPath()}: ${err.message}`);
    return res.status(500).json({ success: false, message: "Page template unavailable", data: null });
  }

  try {
    const id = await TravelPackage.resolveId(req.params.idOrSlug);
    const pkg = id ? await TravelPackage.findById(id) : null;

    if (!pkg) return sendHtml(res, 404, template);
    // Drafts and pending packages keep the site defaults so their details are not exposed.
    if (pkg.status !== "published") return sendHtml(res, 200, template);

    return sendHtml(res, 200, injectSeoTags(template, buildPackageSeo(pkg, getSiteUrl())));
  } catch (err) {
    // The app still works without package tags, so fall back to the plain page instead of failing.
    console.error(`SEO: package tags failed for "${req.params.idOrSlug}": ${err.message}`);
    return sendHtml(res, 200, template);
  }
};
