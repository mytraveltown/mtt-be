/**
 * One-off: gives every package without a slug a unique one based on its name.
 * Safe to re-run; packages that already have a slug are left untouched.
 * Usage: npm run backfill:package-slugs (after running migrations/007_add_package_slug.sql)
 */
require("dotenv").config();
const db = require("../src/config/db");
const TravelPackage = require("../src/models/package.model");

const backfill = async () => {
  const [rows] = await db.query(
    "SELECT id, package_name FROM travel_package WHERE slug IS NULL OR slug = '' ORDER BY id ASC"
  );

  for (const row of rows) {
    const slug = await TravelPackage.generateUniqueSlug(row.package_name, row.id);
    await db.query("UPDATE travel_package SET slug = ? WHERE id = ?", [slug, row.id]);
    console.log(`#${row.id} -> ${slug}`);
  }

  console.log(`Backfilled ${rows.length} package slug(s).`);
};

backfill()
  .then(() => db.end())
  .catch(async (err) => {
    console.error("Slug backfill failed:", err);
    await db.end();
    process.exitCode = 1;
  });
