const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AWS_REGION = "ap-south-1";
process.env.AWS_S3_BUCKET_NAME = "test-bucket";

const s3 = require("../src/utils/s3");
const mediaService = require("../src/services/media.service");
const {
  buildObjectKey,
  toMediaPath,
  mediaPathToKey,
  keyBelongsTo,
  parseUploadList,
} = require("../src/utils/mediaPath");

const UUID = "3f2a1b4c-1111-4222-8333-944455556666";

// Stubs every S3 call the service makes; `objects` maps key -> { contentType, contentLength }.
const stubS3 = (objects = {}) => {
  const calls = { attached: [], deleted: [] };
  s3.headObject = async (key) => objects[key] || null;
  s3.markObjectAttached = async (key) => calls.attached.push(key);
  s3.deleteObject = async (key) => calls.deleted.push(key);
  s3.createPresignedPutUrl = async ({ key, contentType }) => ({
    url: `https://test-bucket.s3.amazonaws.com/${key}?signed`,
    headers: { "Content-Type": contentType },
  });
  return calls;
};

test("buildObjectKey puts the uploader id and a uuid in the key", () => {
  const key = buildObjectKey("packages", 7, "mp4");
  assert.match(key, /^packages\/7\/[0-9a-f-]{36}\.mp4$/);
  assert.equal(mediaPathToKey(toMediaPath(key)), key);
});

test("mediaPathToKey rejects traversal, legacy paths and malformed keys", () => {
  assert.equal(mediaPathToKey("/media/../../etc/passwd"), null);
  assert.equal(mediaPathToKey("/uploads/users/a.jpg"), null);
  assert.equal(mediaPathToKey(`/media/users/0/${UUID}.jpg`), null);
  assert.equal(mediaPathToKey(`https://evil.example/media/users/1/${UUID}.jpg`), null);
});

test("keyBelongsTo only matches the same folder and uploader", () => {
  const key = `users/12/${UUID}.jpg`;
  assert.equal(keyBelongsTo(key, "users", 12), true);
  assert.equal(keyBelongsTo(key, "users", 13), false);
  assert.equal(keyBelongsTo(key, "agents", 12), false);
});

test("parseUploadList accepts arrays, JSON strings and a single path, and rejects junk", () => {
  assert.deepEqual(parseUploadList(undefined), []);
  assert.deepEqual(parseUploadList('["/media/a", " /media/b "]'), ["/media/a", "/media/b"]);
  assert.deepEqual(parseUploadList("/media/a"), ["/media/a"]);
  assert.equal(parseUploadList("[not json"), null);
  assert.equal(parseUploadList([1, 2]), null);
});

test("createUploadUrl rejects a type outside the scope and an oversized file", async () => {
  stubS3();
  await assert.rejects(
    mediaService.createUploadUrl({ scope: "profile", contentType: "application/pdf", contentLength: 10, userId: 1 }),
    { statusCode: 400 }
  );
  await assert.rejects(
    mediaService.createUploadUrl({ scope: "profile", contentType: "image/png", contentLength: 50 * 1024 * 1024, userId: 1 }),
    { statusCode: 400, message: /5 MB/ }
  );
});

test("createUploadUrl returns the S3 URL to store, in the scope folder for the uploader", async () => {
  stubS3();
  const result = await mediaService.createUploadUrl({
    scope: "agent-document",
    contentType: "application/pdf",
    contentLength: 1024,
    userId: 42,
  });
  assert.match(
    result.path,
    /^https:\/\/test-bucket\.s3\.ap-south-1\.amazonaws\.com\/agents\/42\/[0-9a-f-]{36}\.pdf$/
  );
  assert.equal(result.method, "PUT");
});

test("attachUpload refuses a path uploaded by another user", async () => {
  stubS3({ [`users/99/${UUID}.jpg`]: { contentType: "image/jpeg", contentLength: 100 } });
  await assert.rejects(
    mediaService.attachUpload(`/media/users/99/${UUID}.jpg`, { scope: "profile", userId: 12 }),
    { statusCode: 400, message: /Invalid file reference/ }
  );
});

test("attachUpload fails when the object was never uploaded", async () => {
  stubS3();
  await assert.rejects(
    mediaService.attachUpload(`/media/users/12/${UUID}.jpg`, { scope: "profile", userId: 12 }),
    { statusCode: 400, message: /not found/ }
  );
});

test("attachUpload clears the pending tag and reports the media kind", async () => {
  const key = `packages/12/${UUID}.mp4`;
  const calls = stubS3({ [key]: { contentType: "video/mp4", contentLength: 1000 } });
  const url = `https://test-bucket.s3.ap-south-1.amazonaws.com/${key}`;
  const result = await mediaService.attachUpload(url, { scope: "package-media", userId: 12 });
  assert.deepEqual(result, { path: url, mimeType: "video/mp4", kind: "video" });
  // The older "/media/..." form is still accepted and stored as the full URL.
  const legacy = await mediaService.attachUpload(`/media/${key}`, { scope: "package-media", userId: 12 });
  assert.equal(legacy.path, url);
  assert.deepEqual(calls.attached, [key, key]);
});

test("attachUploads enforces the scope's file count", async () => {
  stubS3();
  const paths = Array.from({ length: 6 }, () => `/media/reviews/12/${UUID}.jpg`);
  await assert.rejects(mediaService.attachUploads(paths, { scope: "review-media", userId: 12 }), {
    statusCode: 400,
    message: /up to 5 files/,
  });
});

test("deleteStoredFile deletes S3 objects and never deletes shared legacy assets", async () => {
  const calls = stubS3();
  await mediaService.deleteStoredFile(`/media/users/12/${UUID}.jpg`);
  await mediaService.deleteStoredFile("/uploads/profile/default-avatar.png");
  await mediaService.deleteStoredFile("/uploads/users/../../package.json");
  assert.deepEqual(calls.deleted, [`users/12/${UUID}.jpg`]);
  assert.ok(require("fs").existsSync(require("path").join(__dirname, "../package.json")));
});

test("legacyPathToKey maps per-record uploads and rejects anything else", () => {
  const { legacyPathToKey } = require("../src/utils/mediaPath");
  assert.equal(legacyPathToKey("/uploads/agents/agent_20_aadhar_1.png"), "uploads/agents/agent_20_aadhar_1.png");
  assert.equal(legacyPathToKey("/uploads/profile/default-avatar.png"), null);
  assert.equal(legacyPathToKey("/uploads/agents/../../.env"), null);
  assert.equal(legacyPathToKey("/uploads/agents/..%2F.env"), null);
});

test("getLegacyViewUrl returns null when the file is not on S3, so the local copy is served", async () => {
  stubS3();
  s3.createPresignedGetUrl = async (key) => `https://test-bucket.s3.amazonaws.com/${key}?signed`;
  assert.equal(await mediaService.getLegacyViewUrl("/uploads/users/user_404_1.jpg"), null);
  stubS3({ "uploads/users/user_3_1.jpg": { contentType: "image/jpeg", contentLength: 10 } });
  s3.createPresignedGetUrl = async (key) => `https://test-bucket.s3.amazonaws.com/${key}?signed`;
  assert.match(await mediaService.getLegacyViewUrl("/uploads/users/user_3_1.jpg"), /uploads\/users\/user_3_1\.jpg/);
});

test("attachUpload rejects an S3 URL on another bucket", async () => {
  stubS3({ [`users/12/${UUID}.jpg`]: { contentType: "image/jpeg", contentLength: 10 } });
  await assert.rejects(
    mediaService.attachUpload(`https://evil-bucket.s3.ap-south-1.amazonaws.com/users/12/${UUID}.jpg`, {
      scope: "profile",
      userId: 12,
    }),
    { statusCode: 400 }
  );
});

test("presignMediaUrls swaps stored S3 URLs in a response for presigned ones and leaves the rest", async () => {
  const presignMediaUrls = require("../src/middlewares/presignMedia.middleware");
  s3.createPresignedGetUrl = async (key) => `https://signed.example/${key}?sig=1`;
  const stored = "https://test-bucket.s3.ap-south-1.amazonaws.com/uploads/agents/a.png";
  const body = { agent: { aadhar_document: stored, name: "A" }, media: [{ file_path: stored }, { file_path: "/uploads/x.png" }] };

  const sent = await new Promise((resolve) => {
    const res = { json: resolve };
    presignMediaUrls({}, res, () => res.json(body));
  });

  assert.equal(sent.agent.aadhar_document, "https://signed.example/uploads/agents/a.png?sig=1");
  assert.equal(sent.media[0].file_path, "https://signed.example/uploads/agents/a.png?sig=1");
  assert.equal(sent.media[1].file_path, "/uploads/x.png");
  assert.equal(body.agent.aadhar_document, stored, "original body is not mutated");
});

test("toViewUrl falls back to the local /uploads path when S3 signing fails", async () => {
  s3.createPresignedGetUrl = async () => {
    throw new Error("network down");
  };
  const stored = "https://test-bucket.s3.ap-south-1.amazonaws.com/uploads/users/u.jpg";
  assert.equal(await mediaService.toViewUrl(stored), "/uploads/users/u.jpg");
});
