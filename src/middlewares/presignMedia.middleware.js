const s3 = require("../utils/s3");
const { toViewUrl } = require("../services/media.service");

/** Unique strings in `value` (deep) that start with `prefix`. */
const collectUrls = (value, prefix, found = new Set()) => {
  if (typeof value === "string") {
    if (value.startsWith(prefix)) found.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, prefix, found));
  } else if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    Object.values(value).forEach((item) => collectUrls(item, prefix, found));
  }
  return found;
};

/** Copy of `value` with every string in `replacements` swapped; the original is not mutated. */
const replaceUrls = (value, replacements) => {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceUrls(item, replacements));
  if (value && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceUrls(item, replacements)])
    );
  }
  return value;
};

/**
 * The DB stores unsigned S3 URLs ("https://<bucket>.s3.<region>.amazonaws.com/<key>") but the
 * bucket is private. This wraps res.json so every such URL in any API response is swapped for a
 * presigned GET URL, without each controller having to know which fields hold media.
 */
const presignMediaUrls = (req, res, next) => {
  const sendJson = res.json.bind(res);

  res.json = (body) => {
    const prefix = s3.bucketBaseUrl();
    const urls = prefix ? collectUrls(body, prefix) : null;
    if (!urls?.size) return sendJson(body);

    Promise.all([...urls].map(async (url) => [url, await toViewUrl(url)]))
      .then((pairs) => sendJson(replaceUrls(body, new Map(pairs))))
      .catch((err) => {
        console.error("[media] Failed to presign response URLs:", err.message);
        sendJson(body);
      });
    return res;
  };

  next();
};

module.exports = presignMediaUrls;
module.exports.collectUrls = collectUrls;
module.exports.replaceUrls = replaceUrls;
