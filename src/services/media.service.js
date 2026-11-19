const fs = require("fs/promises");
const path = require("path");
const { getUploadScope } = require("../config/upload.config");
const s3 = require("../utils/s3");
const {
  buildObjectKey,
  mediaPathToKey,
  legacyPathToKey,
  keyBelongsTo,
  isLegacyUploadPath,
  LEGACY_UPLOAD_PREFIX,
} = require("../utils/mediaPath");

const UPLOAD_URL_TTL_SECONDS = 5 * 60;
const VIEW_URL_TTL_SECONDS = 60 * 60;
const LEGACY_UPLOAD_ROOT = path.resolve(__dirname, "../../uploads");
// Per-record folders written by the old disk uploads. Shared assets elsewhere in
// /uploads (e.g. a default avatar) are never deleted.
const LEGACY_DELETABLE_FOLDERS = ["users", "agents", "bank", "reviews", "packages"];

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const formatMegabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

const requireScope = (scopeName) => {
  const scope = getUploadScope(scopeName);
  if (!scope) throw httpError(400, "Unknown upload type");
  return scope;
};

const requireS3 = () => {
  if (!s3.isS3Configured()) throw httpError(503, "File uploads are not configured on the server");
};

const mediaKindOf = (mimeType) => {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return "document";
};

/**
 * Issues a presigned PUT URL for one file. The browser must send `headers` with
 * the PUT exactly as returned, then submit `path` with the form that uses the file.
 */
const createUploadUrl = async ({ scope: scopeName, contentType, contentLength, userId }) => {
  const scope = requireScope(scopeName);

  const extension = scope.types[contentType];
  if (!extension) throw httpError(400, scope.typeError);

  const size = Number(contentLength);
  if (!Number.isInteger(size) || size <= 0) throw httpError(400, "contentLength must be the file size in bytes");
  if (size > scope.maxBytes) throw httpError(400, `Each file must be ${formatMegabytes(scope.maxBytes)} or smaller`);

  requireS3();

  const key = buildObjectKey(scope.folder, userId, extension);
  const { url, headers } = await s3.createPresignedPutUrl({
    key,
    contentType,
    contentLength: size,
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  });

  return {
    uploadUrl: url,
    method: "PUT",
    headers,
    // Stored as-is in the DB; API responses presign it (presignMediaUrls middleware).
    path: s3.objectUrl(key),
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  };
};

/**
 * Validates a "/media/..." path submitted with a form and attaches the file:
 *  - the path must be in the scope's folder and issued to `userId`
 *  - the object must exist in S3 with an allowed type and size
 * Then clears the pending tag so the lifecycle rule keeps it.
 */
const attachUpload = async (value, { scope: scopeName, userId }) => {
  const scope = requireScope(scopeName);
  // Full S3 URL from /api/uploads/presign, or the older "/media/..." form.
  const key = s3.keyFromObjectUrl(value) || mediaPathToKey(value);
  if (!key || !keyBelongsTo(key, scope.folder, userId)) {
    throw httpError(400, "Invalid file reference. Please upload the file again.");
  }

  requireS3();

  const head = await s3.headObject(key);
  if (!head) throw httpError(400, "Uploaded file not found. Please upload it again.");

  const contentType = head.contentType || "";
  if (!scope.types[contentType]) throw httpError(400, scope.typeError);
  if (head.contentLength > scope.maxBytes) {
    throw httpError(400, `Each file must be ${formatMegabytes(scope.maxBytes)} or smaller`);
  }

  await s3.markObjectAttached(key);

  return { path: s3.objectUrl(key), mimeType: contentType, kind: mediaKindOf(contentType) };
};

/** attachUpload for a list, keeping order. Enforces the scope's file count. */
const attachUploads = async (values, options) => {
  const scope = requireScope(options.scope);
  if (scope.maxFiles && values.length > scope.maxFiles) {
    throw httpError(400, `You can upload up to ${scope.maxFiles} files`);
  }
  return Promise.all(values.map((value) => attachUpload(value, options)));
};

/**
 * Attaches the single-file form fields in `fields` that have a value.
 * Returns { [field]: path } for the fields that were sent.
 */
const attachUploadFields = async (body, fields, options) => {
  const attached = {};
  for (const field of fields) {
    const value = typeof body?.[field] === "string" ? body[field].trim() : "";
    if (!value) continue;
    attached[field] = (await attachUpload(value, options)).path;
  }
  return attached;
};

/** Short-lived URL a browser can load a "/media/..." object from. */
const getViewUrl = (key) => {
  requireS3();
  return s3.createPresignedGetUrl(key, VIEW_URL_TTL_SECONDS);
};

// Whether a legacy file is on S3, cached so /uploads requests do not HEAD S3 every time.
const LEGACY_FOUND_TTL_MS = 60 * 60 * 1000;
const LEGACY_MISSING_TTL_MS = 5 * 60 * 1000;
const LEGACY_CACHE_LIMIT = 5000;
const legacyExistsCache = new Map();

const legacyObjectExists = async (key) => {
  const cached = legacyExistsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;

  const exists = Boolean(await s3.headObject(key));
  if (legacyExistsCache.size >= LEGACY_CACHE_LIMIT) legacyExistsCache.clear();
  legacyExistsCache.set(key, {
    exists,
    expiresAt: Date.now() + (exists ? LEGACY_FOUND_TTL_MS : LEGACY_MISSING_TTL_MS),
  });
  return exists;
};

/**
 * Presigned URL for a legacy "/uploads/..." path that has been copied to S3,
 * or null when it is not on S3 (the caller then falls back to the local file).
 */
const getLegacyViewUrl = async (storedPath) => {
  const key = legacyPathToKey(storedPath);
  if (!key || !s3.isS3Configured()) return null;
  if (!(await legacyObjectExists(key))) return null;
  return s3.createPresignedGetUrl(key, VIEW_URL_TTL_SECONDS);
};

const deleteLegacyFile = async (storedPath) => {
  const fullPath = path.resolve(LEGACY_UPLOAD_ROOT, storedPath.slice(LEGACY_UPLOAD_PREFIX.length));
  const isInDeletableFolder = LEGACY_DELETABLE_FOLDERS.some((folder) =>
    fullPath.startsWith(path.join(LEGACY_UPLOAD_ROOT, folder) + path.sep)
  );
  if (!isInDeletableFolder) return;
  try {
    await fs.unlink(fullPath);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
};

/**
 * Viewable URL for a stored DB value that is a full S3 URL: presigned for this bucket. When S3 is
 * unreachable, a migrated legacy file ("uploads/...") falls back to its "/uploads/..." path, which
 * the server still serves from disk. Other values are returned unchanged.
 */
const toViewUrl = async (storedValue) => {
  const key = s3.keyFromObjectUrl(storedValue);
  if (!key) return storedValue;
  try {
    return await s3.createPresignedGetUrl(key, VIEW_URL_TTL_SECONDS);
  } catch (err) {
    console.error(`[media] Could not presign ${key}:`, err.message);
    return key.startsWith("uploads/") ? `/${key}` : storedValue;
  }
};

/**
 * Deletes a file referenced by a stored DB value: an S3 object ("/media/...") or a
 * legacy local upload ("/uploads/..."). Best effort: failures are logged, never thrown,
 * so a storage hiccup does not fail the request that removed the record.
 */
const deleteStoredFile = async (storedPath) => {
  try {
    if (isLegacyUploadPath(storedPath)) {
      await deleteLegacyFile(storedPath);
      // Also remove its S3 copy from the /uploads migration, if any.
      const legacyKey = legacyPathToKey(storedPath);
      if (legacyKey && s3.isS3Configured()) {
        await s3.deleteObject(legacyKey);
        legacyExistsCache.delete(legacyKey);
      }
      return;
    }
    const key = s3.keyFromObjectUrl(storedPath) || mediaPathToKey(storedPath);
    if (!key || !s3.isS3Configured()) return;
    await s3.deleteObject(key);
    // A migrated legacy file may still have its original copy on disk.
    if (key.startsWith("uploads/")) await deleteLegacyFile(`/${key}`);
  } catch (err) {
    console.error(`[media] Failed to delete ${storedPath}:`, err.message);
  }
};

const deleteStoredFiles = (storedPaths = []) =>
  Promise.all(storedPaths.filter(Boolean).map(deleteStoredFile));

module.exports = {
  createUploadUrl,
  attachUpload,
  attachUploads,
  attachUploadFields,
  getViewUrl,
  getLegacyViewUrl,
  toViewUrl,
  deleteStoredFile,
  deleteStoredFiles,
};
