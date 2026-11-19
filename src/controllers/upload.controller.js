const mediaService = require("../services/media.service");

// POST /api/uploads/presign  { scope, contentType, contentLength }
exports.presign = async (req, res) => {
  try {
    const { scope, contentType, contentLength } = req.body || {};
    if (typeof scope !== "string" || typeof contentType !== "string") {
      return res.status(400).json({
        success: false,
        message: "scope and contentType are required",
        data: null,
      });
    }

    const data = await mediaService.createUploadUrl({
      scope,
      contentType,
      contentLength,
      userId: req.user.id,
    });

    return res.status(200).json({ success: true, message: "Upload URL created", data });
  } catch (err) {
    if (!err.statusCode) console.error(err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.statusCode ? err.message : "Could not prepare the upload",
      data: null,
    });
  }
};
