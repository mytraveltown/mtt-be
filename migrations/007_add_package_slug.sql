-- SEO-friendly package URLs: /package/goa-beach-getaway instead of /package/83.
-- The column is nullable so existing rows survive the ALTER; run
-- `npm run backfill:package-slugs` afterwards to fill slugs for existing packages.

ALTER TABLE travel_package
  ADD COLUMN slug VARCHAR(220) NULL AFTER package_name,
  ADD UNIQUE KEY uq_travel_package_slug (slug);
