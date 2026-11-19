const multer = require("multer");

const parseTextFields = multer({ limits: { fields: 100, fieldSize: 1024 * 1024 } }).none();

/**
 * Parses multipart/form-data text fields into req.body (JSON bodies pass straight through).
 * Files are no longer accepted here: the browser uploads them to S3 first and sends the
 * returned "/media/..." paths as plain fields.
 */
const formFields = (req, res, next) => {
  parseTextFields(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_UNEXPECTED_FILE"
        ? "Files must be uploaded before saving. Please refresh the page and try again."
        : err.message;
    return res.status(400).json({ success: false, message, data: null });
  });
};

module.exports = formFields;
