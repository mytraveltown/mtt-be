const TravelPackage = require("../models/package.model");

const DEFAULT_SITE_URL = "https://mytraveltown.com";
// Crawlers re-fetch often; an hour keeps new packages discoverable without hitting the DB per request.
const CACHE_SECONDS = 60 * 60;

const getSiteUrl = () => (process.env.FRONTEND_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const toW3cDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildUrlEntry = ({ loc, lastmod }) =>
  [
    "  <url>",
    `    <loc>${escapeXml(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod}</lastmod>` : null,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");

// GET /api/sitemap/packages.xml
exports.getPackagesSitemap = async (_req, res) => {
  try {
    const siteUrl = getSiteUrl();
    const packages = await TravelPackage.findSitemapEntries();

    const entries = packages.map((pkg) =>
      buildUrlEntry({
        loc: `${siteUrl}/package/${pkg.slug || pkg.id}`,
        lastmod: toW3cDate(pkg.updated_at),
      })
    );

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries,
      "</urlset>",
    ].join("\n");

    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    res.status(200).send(xml);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
