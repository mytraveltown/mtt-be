const mediaService = require("../services/media.service");
const { isValidObjectKey } = require("../utils/mediaPath");

// Shorter than the presigned URL's own lifetime, so a cached redirect never points at an expired URL.
const REDIRECT_CACHE_SECONDS = 5 * 60;

/**
 * GET /uploads/<folder>/<file>: serves a legacy upload from S3 when it has been copied there
 * (scripts/migrate-uploads-to-s3.js). Otherwise, or on any S3 error, it falls through to the
 * old behaviour: the local file, then MEDIA_FALLBACK_URL.
 */
exports.legacyRedirect = async (req, res, next) => {
  try {
    const url = await mediaService.getLegacyViewUrl(`/uploads${req.path}`);
    if (!url) return next();
    res.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
    return res.redirect(302, url);
  } catch (err) {
    console.error(`[media] S3 lookup failed for /uploads${req.path}, serving local copy:`, err.message);
    return next();
  }
};

// GET /media/<folder>/<userId>/<uuid>.<ext>  ->  302 to a short-lived presigned S3 URL
exports.redirect = async (req, res) => {
  try {
    const key = req.path.replace(/^\//, "");
    if (!isValidObjectKey(key)) {
      return res.status(404).json({ success: false, message: "File not found", data: null });
    }

    const url = await mediaService.getViewUrl(key);
    res.set("Cache-Control", `private, max-age=${REDIRECT_CACHE_SECONDS}`);
    return res.redirect(302, url);
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Could not load the file",
      data: null,
    });
  }
};
