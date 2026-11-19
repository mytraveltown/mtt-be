const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  DeleteObjectTaggingCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/**
 * Thin wrapper over the AWS SDK. Configured from env:
 *   AWS_REGION, AWS_S3_BUCKET_NAME                 required
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY       optional; without them the SDK's
 *                                                  default chain is used (IAM role on EC2/ECS)
 */

// New objects carry this tag until a form attaches them. An S3 lifecycle rule on
// the tag expires uploads that were never saved (see docs/s3-uploads.md).
const PENDING_TAG = "upload-status=pending";

const bucket = () => process.env.AWS_S3_BUCKET_NAME;

const isS3Configured = () => Boolean(process.env.AWS_REGION && bucket());

/** "https://<bucket>.s3.<region>.amazonaws.com/": the prefix of every URL stored in the DB. */
const bucketBaseUrl = () =>
  isS3Configured() ? `https://${bucket()}.s3.${process.env.AWS_REGION}.amazonaws.com/` : null;

/** Unsigned object URL; this is what the DB stores. The bucket is private, so it is presigned for viewing. */
const objectUrl = (key) => `${bucketBaseUrl()}${key}`;

/** Key of an object URL on this bucket (query string ignored), or null for any other value. */
const keyFromObjectUrl = (value) => {
  const base = bucketBaseUrl();
  if (!base || typeof value !== "string" || !value.startsWith(base)) return null;
  try {
    return decodeURIComponent(new URL(value).pathname.slice(1)) || null;
  } catch {
    return null;
  }
};

let client = null;
const getClient = () => {
  if (client) return client;

  const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } = process.env;
  client = new S3Client({
    region: AWS_REGION,
    // Newer SDKs add a CRC32 of the (empty) presign-time body to PUT URLs, which makes
    // every browser upload fail the checksum. Only send checksums when S3 requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    ...(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY
      ? { credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } }
      : {}),
  });
  return client;
};

/**
 * Presigned PUT. Content-Type, Content-Length and the pending tag are signed, so S3
 * rejects an upload whose type, size or tag differs from what the API approved.
 * Returns the URL and the exact headers the browser must send with it.
 */
const createPresignedPutUrl = async ({ key, contentType, contentLength, expiresIn }) => {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    Tagging: PENDING_TAG,
  });

  const url = await getSignedUrl(getClient(), command, {
    expiresIn,
    signableHeaders: new Set(["content-type"]),
    unhoistableHeaders: new Set(["x-amz-tagging"]),
  });

  return {
    url,
    headers: { "Content-Type": contentType, "x-amz-tagging": PENDING_TAG },
  };
};

// GET URLs are signed at the start of the current hour and live for two, so the same file gets
// the same URL for a whole hour (browsers can cache it) and every URL has at least an hour left.
const SIGNING_WINDOW_MS = 60 * 60 * 1000;

const createPresignedGetUrl = (key, minimumValiditySeconds) => {
  const signingDate = new Date(Math.floor(Date.now() / SIGNING_WINDOW_MS) * SIGNING_WINDOW_MS);
  const expiresIn = minimumValiditySeconds + SIGNING_WINDOW_MS / 1000;
  return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn,
    signingDate,
  });
};

/** Size and type of an object, or null when it does not exist. */
const headObject = async (key) => {
  try {
    const head = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { contentLength: head.ContentLength, contentType: head.ContentType };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") return null;
    throw err;
  }
};

/** Server-side upload (used by the legacy /uploads migration). */
const putObject = ({ key, body, contentType }) =>
  getClient().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  );

/** Removes the pending tag so the lifecycle rule keeps the object. */
const markObjectAttached = (key) =>
  getClient().send(new DeleteObjectTaggingCommand({ Bucket: bucket(), Key: key }));

const deleteObject = (key) =>
  getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));

module.exports = {
  isS3Configured,
  bucketBaseUrl,
  objectUrl,
  keyFromObjectUrl,
  createPresignedPutUrl,
  createPresignedGetUrl,
  headObject,
  putObject,
  markObjectAttached,
  deleteObject,
};
