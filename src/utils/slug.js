const MAX_SLUG_LENGTH = 200;
const FALLBACK_SLUG = "package";

/**
 * Turns free text (package names may contain HTML from the rich-text editor)
 * into a lowercase, hyphenated, URL-safe slug, e.g. "Goa <b>Beach</b> Trip!" -> "goa-beach-trip".
 */
const slugify = (value) => {
  const slug = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || FALLBACK_SLUG;
};

/** Purely numeric route params are legacy package ids, anything else is a slug. */
const isNumericId = (value) => /^\d+$/.test(String(value ?? ""));

module.exports = { slugify, isNumericId };
