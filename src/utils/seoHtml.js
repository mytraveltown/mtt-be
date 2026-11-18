const SITE_NAME = "MyTravelTown";
const META_DESCRIPTION_LENGTH = 160;
const DEFAULT_OG_IMAGE_PATH = "/og-image.jpg";
/** Only the default share card has a known size; package photos vary. */
const DEFAULT_OG_IMAGE_META = { type: "image/jpeg", width: 1200, height: 630 };

// Must match the marker in the frontend index.html; the React SEO component removes
// these tags on load, so injected tags never duplicate the ones Helmet renders.
const FALLBACK_TAG_PATTERN = /[ \t]*<meta\b[^>]*\bdata-seo-fallback\b[^>]*>[ \t]*(?:\r?\n)?/gi;
// The document has a single <title>; it is always replaced by the page-specific one.
const TITLE_PATTERN = /[ \t]*<title\b[^>]*>[\s\S]*?<\/title>[ \t]*(?:\r?\n)?/i;

const EMOJI_PATTERN = /[\p{Extended_Pictographic}\p{Regional_Indicator}️‍⃣]/gu;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Single-line text for SEO tags: drops HTML, emojis and divider runs, collapses whitespace. */
const toPlainText = (value) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(EMOJI_PATTERN, "")
    .replace(/(^|\s)[-*_=~]{3,}(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const capitalize = (text) => (text ? String(text).replace(/\b\w/g, (char) => char.toUpperCase()) : "");

const formatINR = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;

const withSiteName = (title) => (title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`);

/**
 * Title and description for a package page. Mirrors the frontend Package page
 * so crawlers that skip JavaScript see the same tags as the rendered app.
 */
const buildPackageSeo = (pkg, siteUrl) => {
  const name = toPlainText(pkg.package_name);
  const plainDescription = toPlainText(pkg.location_description);
  const price = Number(pkg.price);

  const summary = [
    `${name} - ${pkg.days} Days / ${pkg.nights} Nights`,
    `${capitalize(pkg.from_location)} to ${capitalize(pkg.to_location)}`,
    price > 0 ? `from ${formatINR(price)} per person` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return {
    title: withSiteName(name),
    description: plainDescription.slice(0, META_DESCRIPTION_LENGTH) || summary,
    url: `${siteUrl}/package/${pkg.slug || pkg.id}`,
    image: `${siteUrl}${DEFAULT_OG_IMAGE_PATH}`,
    type: "product",
  };
};

const renderSeoTags = ({ title, description, url, image, type }) => {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(url);
  const i = escapeHtml(image);

  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" data-seo-fallback />`,
    `<link rel="canonical" href="${u}" data-seo-fallback />`,
    `<meta property="og:site_name" content="${SITE_NAME}" data-seo-fallback />`,
    `<meta property="og:type" content="${escapeHtml(type)}" data-seo-fallback />`,
    `<meta property="og:title" content="${t}" data-seo-fallback />`,
    `<meta property="og:description" content="${d}" data-seo-fallback />`,
    `<meta property="og:url" content="${u}" data-seo-fallback />`,
    `<meta property="og:image" content="${i}" data-seo-fallback />`,
    `<meta property="og:image:secure_url" content="${i}" data-seo-fallback />`,
    ...(String(image).endsWith(DEFAULT_OG_IMAGE_PATH)
      ? [
          `<meta property="og:image:type" content="${DEFAULT_OG_IMAGE_META.type}" data-seo-fallback />`,
          `<meta property="og:image:width" content="${DEFAULT_OG_IMAGE_META.width}" data-seo-fallback />`,
          `<meta property="og:image:height" content="${DEFAULT_OG_IMAGE_META.height}" data-seo-fallback />`,
        ]
      : []),
    `<meta property="og:image:alt" content="${SITE_NAME}" data-seo-fallback />`,
    `<meta name="twitter:card" content="summary_large_image" data-seo-fallback />`,
    `<meta name="twitter:title" content="${t}" data-seo-fallback />`,
    `<meta name="twitter:description" content="${d}" data-seo-fallback />`,
    `<meta name="twitter:image" content="${i}" data-seo-fallback />`,
  ]
    .map((tag) => `  ${tag}`)
    .join("\n");
};

/** Replaces the default (data-seo-fallback) tags in the built index.html with page-specific ones. */
const injectSeoTags = (html, seo) => {
  const stripped = html.replace(TITLE_PATTERN, "").replace(FALLBACK_TAG_PATTERN, "");
  return stripped.replace(/<\/head>/i, `${renderSeoTags(seo)}\n</head>`);
};

module.exports = { escapeHtml, toPlainText, buildPackageSeo, injectSeoTags };
