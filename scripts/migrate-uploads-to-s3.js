/**
 * Copies legacy "/uploads/..." files referenced in the database to S3.
 *
 * The database is only READ: rows keep their "/uploads/..." paths. Each file is stored in S3
 * under the same path ("uploads/agents/x.png"), and GET /uploads/* serves the S3 copy first,
 * falling back to the local file and then MEDIA_FALLBACK_URL (see media.controller.legacyRedirect).
 *
 * Usage (from the backend folder):
 *   node scripts/migrate-uploads-to-s3.js scan               # list what would be migrated
 *   node scripts/migrate-uploads-to-s3.js backup             # DB dump + download every file
 *   node scripts/migrate-uploads-to-s3.js upload [dir]       # copy the backup to S3 (default: latest)
 *   node scripts/migrate-uploads-to-s3.js verify             # check every DB path exists in S3
 *   node scripts/migrate-uploads-to-s3.js rewrite-db [--apply]  # store full S3 URLs in the DB
 *   node scripts/migrate-uploads-to-s3.js revert-db [--apply]   # undo rewrite-db
 *
 * rewrite-db / revert-db only print what they would change unless --apply is passed. With --apply
 * they first dump the media tables to ./backups, and abort if the dump fails.
 *
 * Every command is safe to re-run. Backups go to ./backups (git-ignored); they contain identity
 * documents, so move them to secure storage and delete the local copy when done.
 */
require("dotenv").config({ quiet: true });

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const db = require("../src/config/db");
const s3 = require("../src/utils/s3");
const { legacyPathToKey, mediaPathToKey } = require("../src/utils/mediaPath");

const ROOT = path.resolve(__dirname, "..");
const LOCAL_UPLOADS = path.join(ROOT, "uploads");
const BACKUP_ROOT = path.join(ROOT, "backups");
const CONCURRENCY = 5;

// Every column that stores a "/uploads/..." path (found by scanning all text columns).
const MEDIA_COLUMNS = [
  { table: "users", columns: ["profile"] },
  {
    table: "agent",
    columns: ["aadhar_document", "aadhar_document_back", "dl_document", "dl_document_back", "company_document"],
  },
  { table: "bank", columns: ["bank_document", "cancelled_cheque"] },
  { table: "travel_package_media", columns: ["file_path"] },
  { table: "package_review_media", columns: ["file_path"] },
];

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
};

const contentTypeOf = (filePath) =>
  CONTENT_TYPES[path.extname(filePath).slice(1).toLowerCase()] || "application/octet-stream";

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/** Runs `worker` over `items`, `CONCURRENCY` at a time. */
const mapLimit = async (items, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
};

/** Distinct "/uploads/..." paths in the DB, with where each one is used. */
const collectPaths = async () => {
  const byPath = new Map();
  for (const { table, columns } of MEDIA_COLUMNS) {
    for (const column of columns) {
      const [rows] = await db.query(
        `SELECT id, \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` LIKE '/uploads/%'`
      );
      for (const { id, value } of rows) {
        if (!byPath.has(value)) byPath.set(value, []);
        byPath.get(value).push(`${table}.${column}#${id}`);
      }
    }
  }
  return [...byPath.entries()].map(([storedPath, usedBy]) => ({
    path: storedPath,
    key: legacyPathToKey(storedPath),
    usedBy,
  }));
};

const latestBackupDir = () => {
  if (!fs.existsSync(BACKUP_ROOT)) return null;
  const dirs = fs
    .readdirSync(BACKUP_ROOT)
    .filter((name) => name.startsWith("uploads-"))
    .sort();
  return dirs.length ? path.join(BACKUP_ROOT, dirs[dirs.length - 1]) : null;
};

/** Reads a file from local disk, or downloads it from MEDIA_FALLBACK_URL (the live server). */
const fetchFile = async (storedPath) => {
  const localPath = path.join(LOCAL_UPLOADS, storedPath.slice("/uploads/".length));
  if (fs.existsSync(localPath)) return { buffer: await fsp.readFile(localPath), source: "local" };

  const base = (process.env.MEDIA_FALLBACK_URL || "").replace(/\/$/, "");
  if (!base) return { error: "not on local disk and MEDIA_FALLBACK_URL is not set" };

  const url = `${base}${storedPath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) return { error: `download failed (${response.status})` };
  return { buffer: Buffer.from(await response.arrayBuffer()), source: "live server" };
};

const dumpDatabase = async (outFile) => {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  const tables = MEDIA_COLUMNS.map(({ table }) => table);
  const args = [
    `--host=${DB_HOST}`,
    ...(DB_PORT ? [`--port=${DB_PORT}`] : []),
    `--user=${DB_USER}`,
    "--single-transaction",
    "--no-tablespaces",
    `--result-file=${outFile}`,
    DB_NAME,
    ...tables,
  ];
  // Password via env so it never shows in the process list.
  await promisify(execFile)("mysqldump", args, { env: { ...process.env, MYSQL_PWD: DB_PASSWORD } });
};

const exportMediaColumns = async (outFile) => {
  const data = {};
  for (const { table, columns } of MEDIA_COLUMNS) {
    const [rows] = await db.query(
      `SELECT id, ${columns.map((c) => `\`${c}\``).join(", ")} FROM \`${table}\``
    );
    data[table] = rows;
  }
  await fsp.writeFile(outFile, JSON.stringify(data, null, 2));
};

/**
 * Rows of every media column whose value `toNewValue` maps to something different.
 * Returns [{ table, column, id, from, to }].
 */
const planRewrite = async (toNewValue) => {
  const changes = [];
  for (const { table, columns } of MEDIA_COLUMNS) {
    for (const column of columns) {
      const [rows] = await db.query(
        `SELECT id, \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` IS NOT NULL AND \`${column}\` <> ''`
      );
      for (const { id, value } of rows) {
        const to = toNewValue(value);
        if (to && to !== value) changes.push({ table, column, id, from: value, to });
      }
    }
  }
  return changes;
};

const summarise = (changes) =>
  changes.reduce((acc, c) => ({ ...acc, [`${c.table}.${c.column}`]: (acc[`${c.table}.${c.column}`] || 0) + 1 }), {});

/** Fresh dump before any write; throws (aborting the write) when it fails. */
const dumpBeforeWrite = async (label) => {
  await fsp.mkdir(BACKUP_ROOT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(BACKUP_ROOT, `db-before-${label}-${stamp}.sql`);
  await dumpDatabase(file);
  await exportMediaColumns(file.replace(/\.sql$/, ".json"));
  return file;
};

/** Applies `changes` in one transaction. Each UPDATE also matches the old value, so rows edited meanwhile are left alone. */
const applyChanges = async (changes) => {
  const connection = await db.getConnection();
  let updated = 0;
  try {
    await connection.beginTransaction();
    for (const c of changes) {
      const [result] = await connection.query(
        `UPDATE \`${c.table}\` SET \`${c.column}\` = ? WHERE id = ? AND \`${c.column}\` = ?`,
        [c.to, c.id, c.from]
      );
      updated += result.affectedRows;
    }
    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
  return updated;
};

const runRewrite = async ({ label, toNewValue, apply, requireInS3 }) => {
  if (!s3.isS3Configured()) throw new Error("AWS_REGION / AWS_S3_BUCKET_NAME are not set");
  let changes = await planRewrite(toNewValue);

  if (requireInS3) {
    const missing = [];
    await mapLimit(changes, async (c) => {
      if (!(await s3.headObject(s3.keyFromObjectUrl(c.to)))) missing.push(c);
    });
    if (missing.length) {
      console.log(`Skipping ${missing.length} rows whose file is not in S3 (run backup + upload first):`);
      missing.forEach((c) => console.log(`  ${c.table}.${c.column}#${c.id}: ${c.from}`));
      changes = changes.filter((c) => !missing.includes(c));
    }
  }

  console.log(`${label}: ${changes.length} rows`, summarise(changes));
  changes.slice(0, 3).forEach((c) => console.log(`  e.g. ${c.table}.${c.column}#${c.id}: ${c.from} -> ${c.to}`));
  if (!apply) {
    console.log("Dry run, nothing changed. Re-run with --apply to write.");
    return;
  }
  if (!changes.length) return;

  const dump = await dumpBeforeWrite(label);
  console.log(`Backup: ${dump}`);
  console.log(`Updated ${await applyChanges(changes)} of ${changes.length} rows.`);
};

const commands = {
  async scan() {
    const items = await collectPaths();
    const invalid = items.filter((item) => !item.key);
    const byFolder = {};
    for (const item of items) {
      const folder = item.path.split("/")[2];
      byFolder[folder] = (byFolder[folder] || 0) + 1;
    }
    console.log(`Distinct /uploads paths: ${items.length}`, byFolder);
    if (invalid.length) {
      console.log(`Paths that cannot be migrated (unexpected name):`);
      invalid.forEach((item) => console.log(`  ${item.path}  <- ${item.usedBy.join(", ")}`));
    }
  },

  async backup() {
    const items = await collectPaths();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(BACKUP_ROOT, `uploads-${stamp}`);
    await fsp.mkdir(path.join(dir, "files"), { recursive: true });

    await exportMediaColumns(path.join(dir, "media-columns.json"));
    try {
      await dumpDatabase(path.join(dir, "db-media-tables.sql"));
      console.log("DB dump: db-media-tables.sql");
    } catch (err) {
      console.warn(`mysqldump failed (${err.message.split("\n")[0]}); media-columns.json still has every path.`);
    }

    let done = 0;
    const manifest = await mapLimit(items, async (item) => {
      const entry = { path: item.path, key: item.key, usedBy: item.usedBy };
      if (!item.key) return { ...entry, status: "skipped", error: "unexpected path format" };
      try {
        const result = await fetchFile(item.path);
        if (result.error) return { ...entry, status: "missing", error: result.error };
        const target = path.join(dir, "files", item.key);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, result.buffer);
        return { ...entry, status: "backed-up", source: result.source, size: result.buffer.length, sha256: sha256(result.buffer) };
      } catch (err) {
        return { ...entry, status: "missing", error: err.message };
      } finally {
        done += 1;
        if (done % 50 === 0) console.log(`  ${done}/${items.length}`);
      }
    });

    await fsp.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    const count = (status) => manifest.filter((entry) => entry.status === status).length;
    console.log(`Backup: ${dir}`);
    console.log(`  backed up ${count("backed-up")}, missing ${count("missing")}, skipped ${count("skipped")}`);
    manifest
      .filter((entry) => entry.status !== "backed-up")
      .forEach((entry) => console.log(`  ${entry.status}: ${entry.path} (${entry.error}) <- ${entry.usedBy.join(", ")}`));
  },

  async upload(dirArg) {
    if (!s3.isS3Configured()) throw new Error("AWS_REGION / AWS_S3_BUCKET_NAME are not set");
    const dir = dirArg ? path.resolve(dirArg) : latestBackupDir();
    if (!dir) throw new Error("No backup found. Run the backup command first.");
    const manifest = JSON.parse(await fsp.readFile(path.join(dir, "manifest.json"), "utf8"));
    const toUpload = manifest.filter((entry) => entry.status === "backed-up");

    const results = await mapLimit(toUpload, async (entry) => {
      const existing = await s3.headObject(entry.key);
      if (existing && existing.contentLength === entry.size) return "already in S3";
      const body = await fsp.readFile(path.join(dir, "files", entry.key));
      if (sha256(body) !== entry.sha256) throw new Error(`Backup file changed on disk: ${entry.key}`);
      await s3.putObject({ key: entry.key, body, contentType: contentTypeOf(entry.key) });
      return "uploaded";
    });

    const tally = results.reduce((acc, r) => ({ ...acc, [r]: (acc[r] || 0) + 1 }), {});
    console.log(`Upload from ${dir}:`, tally);
  },

  async verify() {
    if (!s3.isS3Configured()) throw new Error("AWS_REGION / AWS_S3_BUCKET_NAME are not set");
    const items = (await collectPaths()).filter((item) => item.key);
    const missing = [];
    await mapLimit(items, async (item) => {
      if (!(await s3.headObject(item.key))) missing.push(item);
    });
    console.log(`In S3: ${items.length - missing.length}/${items.length}`);
    missing.forEach((item) => console.log(`  not in S3: ${item.path} <- ${item.usedBy.join(", ")}`));
  },
};

commands["rewrite-db"] = (arg) =>
  runRewrite({
    label: "rewrite-db",
    apply: arg === "--apply",
    requireInS3: true,
    // "/uploads/x" -> <bucket>/uploads/x ; "/media/<key>" -> <bucket>/<key>
    toNewValue: (value) => {
      const key = legacyPathToKey(value) || mediaPathToKey(value);
      return key ? s3.objectUrl(key) : null;
    },
  });

commands["revert-db"] = (arg) =>
  runRewrite({
    label: "revert-db",
    apply: arg === "--apply",
    requireInS3: false,
    toNewValue: (value) => {
      const key = s3.keyFromObjectUrl(value);
      if (!key) return null;
      return key.startsWith("uploads/") ? `/${key}` : `/media/${key}`;
    },
  });

const [command = "scan", arg] = process.argv.slice(2);
if (!commands[command]) {
  console.error(
    `Unknown command "${command}". Use: scan | backup | upload [dir] | verify | rewrite-db [--apply] | revert-db [--apply]`
  );
  process.exit(1);
}

commands[command](arg)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
