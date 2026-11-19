/**
 * Upload scopes: one entry per kind of file the app accepts.
 *
 * The browser asks for a presigned URL for a scope (POST /api/uploads/presign),
 * PUTs the file straight to S3, then submits the returned `/media/...` path with
 * the form. The scope decides the S3 folder, the allowed MIME types (mapped to
 * the extension stored in the key) and the size cap. S3 itself enforces the
 * size and type because both headers are part of the presigned signature.
 */

const MB = 1024 * 1024;

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const PDF_TYPES = {
  "application/pdf": "pdf",
};

const VIDEO_TYPES = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
};

const pick = (types, mimeTypes) =>
  Object.fromEntries(mimeTypes.map((mimeType) => [mimeType, types[mimeType]]));

const UPLOAD_SCOPES = Object.freeze({
  profile: {
    folder: "users",
    types: IMAGE_TYPES,
    maxBytes: 5 * MB,
    typeError: "Only image files (jpg, png, webp, gif) are allowed",
  },
  "agent-document": {
    folder: "agents",
    types: { ...IMAGE_TYPES, ...PDF_TYPES },
    maxBytes: 10 * MB,
    typeError: "Only image or PDF files are allowed",
  },
  "bank-document": {
    folder: "bank",
    types: { ...pick(IMAGE_TYPES, ["image/jpeg", "image/png"]), ...PDF_TYPES },
    maxBytes: 5 * MB,
    typeError: "Only JPG, PNG and PDF files are allowed.",
  },
  "review-media": {
    folder: "reviews",
    types: {
      ...pick(IMAGE_TYPES, ["image/jpeg", "image/png", "image/webp"]),
      ...pick(VIDEO_TYPES, ["video/mp4", "video/quicktime", "video/webm"]),
    },
    maxBytes: 25 * MB,
    maxFiles: 5,
    typeError: "Only JPG, PNG, WEBP images or MP4, MOV, WEBM videos are allowed",
  },
  "package-media": {
    folder: "packages",
    types: { ...IMAGE_TYPES, ...VIDEO_TYPES },
    maxBytes: 25 * MB,
    maxFiles: 20,
    typeError: "Only image or video files are allowed",
  },
});

const getUploadScope = (name) =>
  Object.prototype.hasOwnProperty.call(UPLOAD_SCOPES, name) ? UPLOAD_SCOPES[name] : null;

module.exports = {
  UPLOAD_SCOPES,
  UPLOAD_SCOPE_NAMES: Object.keys(UPLOAD_SCOPES),
  getUploadScope,
};
