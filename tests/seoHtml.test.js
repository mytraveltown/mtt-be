const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildPackageSeo, injectSeoTags, toPlainText } = require("../src/utils/seoHtml");

const SITE_URL = "https://mytraveltown.com";

const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>MyTravelTown: India&#39;s First AI TravelTech Marketplace</title>
  <meta name="description" content="Default description" data-seo-fallback />
  <meta property="og:title" content="Default title" data-seo-fallback />
  <meta property="og:image" content="${SITE_URL}/og-image.jpg" data-seo-fallback />
  <meta name="google-site-verification" content="keep-me" />
</head>
<body><div id="root"></div></body>
</html>`;

const basePackage = {
  id: 72,
  slug: "goa-beach-escape",
  package_name: "Goa <b>Beach</b> Escape 🌴",
  location_description: "Sun, sand and seafood ✨ on the Goa coast.",
  days: 4,
  nights: 3,
  from_location: "delhi",
  to_location: "goa",
  price: 15000,
};

test("buildPackageSeo uses the package name as title and its description as description", () => {
  const seo = buildPackageSeo(basePackage, SITE_URL);
  assert.equal(seo.title, "Goa Beach Escape | MyTravelTown");
  assert.equal(seo.description, "Sun, sand and seafood on the Goa coast.");
  assert.equal(seo.url, `${SITE_URL}/package/goa-beach-escape`);
  assert.equal(seo.image, `${SITE_URL}/og-image.jpg`);
});

test("buildPackageSeo trims long descriptions to 160 characters", () => {
  const seo = buildPackageSeo({ ...basePackage, location_description: "a".repeat(400) }, SITE_URL);
  assert.equal(seo.description.length, 160);
});

test("buildPackageSeo falls back to a trip summary when the package has no description", () => {
  const seo = buildPackageSeo({ ...basePackage, location_description: null }, SITE_URL);
  assert.equal(seo.description, "Goa Beach Escape - 4 Days / 3 Nights, Delhi to Goa, from ₹15,000 per person");
});

test("buildPackageSeo uses the numeric id in the URL when the package has no slug", () => {
  const seo = buildPackageSeo({ ...basePackage, slug: null }, SITE_URL);
  assert.equal(seo.url, `${SITE_URL}/package/72`);
});

test("injectSeoTags replaces the default title and fallback tags and keeps the rest", () => {
  const html = injectSeoTags(TEMPLATE, buildPackageSeo(basePackage, SITE_URL));
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.match(html, /<title>Goa Beach Escape \| MyTravelTown<\/title>/);
  assert.match(html, /property="og:description" content="Sun, sand and seafood on the Goa coast\."/);
  assert.match(html, /name="description" content="Sun, sand and seafood on the Goa coast\."/);
  assert.doesNotMatch(html, /Default description|Default title/);
  assert.equal((html.match(/property="og:image"/g) || []).length, 1);
  assert.match(html, /google-site-verification" content="keep-me"/);
});

test("injectSeoTags escapes package text so it cannot break out of the attribute", () => {
  const seo = buildPackageSeo(
    { ...basePackage, location_description: `"><script>alert(1)</script>` },
    SITE_URL
  );
  const html = injectSeoTags(TEMPLATE, seo);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /content=""/);
});

test("toPlainText strips HTML, emojis and divider lines", () => {
  assert.equal(toPlainText("<p>Hello 👋</p> --- <i>world</i>"), "Hello world");
});
