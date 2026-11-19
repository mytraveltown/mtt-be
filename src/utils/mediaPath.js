const crypto = require("crypto");

/**
 * Stored media values look like "/media/<folder>/<userId>/<uuid>.<ext>".
 *
 * The "/media/" route redirects to a short-lived presigned S3 URL, so the
 * frontend renders them exactly like the legacy "/uploads/..." paths
 * (VITE_MEDIA_URL + path) and the bucket can stay private.
 *
 * The uploader's user id is part of the key, which is how the API checks that a
 * path submitted with a form belongs to the person submitting it.
 */

const MEDIA_ROUTE_PREFIX = "/media/";
const LEGACY_UPLOAD_PREFIX = "/uploads/";

const OBJECT_KEY_PATTERN =
  /^([a-z-]+)\/([1-9]\d*)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([a-z0-9]{2,5})$/;

const buildObjectKey = (folder, userId, extension) =>
  `${folder}/${userId}/${crypto.randomUUID()}.${extension}`;

const isValidObjectKey = (key) => typeof key === "string" && OBJECT_KEY_PATTERN.test(key);

const toMediaPath = (key) => `${MEDIA_ROUTE_PREFIX}${key}`;

const isMediaPath = (value) =>
  typeof value === "string" && value.startsWith(MEDIA_ROUTE_PREFIX);

const isLegacyUploadPath = (value) =>
  typeof value === "string" && value.startsWith(LEGACY_UPLOAD_PREFIX);

// Legacy disk uploads are mirrored to S3 under the same path: "/uploads/agents/x.png" -> "uploads/agents/x.png".
const LEGACY_UPLOAD_PATTERN = /^\/uploads\/(users|agents|bank|reviews|packages)\/[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{2,5}$/;

/** S3 key of a legacy "/uploads/..." path, or null when the path is not a per-record upload. */
const legacyPathToKey = (value) =>
  typeof value === "string" && LEGACY_UPLOAD_PATTERN.test(value) && !value.includes("..")
    ? value.slice(1)
    : null;

/** Returns the S3 key for a "/media/..." path, or null when the value is not a valid one. */
const mediaPathToKey = (value) => {
  if (!isMediaPath(value)) return null;
  const key = value.slice(MEDIA_ROUTE_PREFIX.length);
  return isValidObjectKey(key) ? key : null;
};

/** True when `key` sits in `folder` and was issued to `userId`. */
const keyBelongsTo = (key, folder, userId) => {
  const match = OBJECT_KEY_PATTERN.exec(key || "");
  return Boolean(match && match[1] === folder && match[2] === String(userId));
};

/**
 * Normalises a multi-file form field into a list of non-empty strings.
 * Accepts an array, a JSON array string (FormData) or a single path.
 */
const parseUploadList = (value) => {
  if (value === undefined || value === null || value === "") return [];

  let list = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[")) {
      try {
        list = JSON.parse(trimmed);
      } catch {
        return null;
      }
    } else {
      list = [trimmed];
    }
  }

  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) return null;
  return list.map((item) => item.trim()).filter(Boolean);
};

module.exports = {
  MEDIA_ROUTE_PREFIX,
  LEGACY_UPLOAD_PREFIX,
  buildObjectKey,
  isValidObjectKey,
  toMediaPath,
  isMediaPath,
  isLegacyUploadPath,
  mediaPathToKey,
  legacyPathToKey,
  keyBelongsTo,
  parseUploadList,
};
