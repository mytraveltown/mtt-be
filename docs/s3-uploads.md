# S3 uploads

Photos, videos and PDFs go straight from the browser to a private S3 bucket. The API never handles the file bytes.

## How it works

```
Browser                         API                                  S3
  | POST /api/uploads/presign     |                                    |
  |  { scope, contentType,        |-- checks scope, type, size         |
  |    contentLength }            |-- signs a PUT URL (5 min)          |
  |<-- { uploadUrl, headers, path }                                    |
  | PUT uploadUrl (file, headers) ------------------------------------>|  stored with tag
  |                               |                                    |  upload-status=pending
  | PUT /api/agents/me            |                                    |
  |  { aadhar: "/media/agents/12/<uuid>.pdf", ... }                    |
  |                               |-- path belongs to this user?       |
  |                               |-- HEAD: exists, type, size ------->|
  |                               |-- remove pending tag ------------->|
  |                               |-- save path in MySQL               |
  |                                                                    |
  | <img src="{VITE_MEDIA_URL}/media/agents/12/<uuid>.pdf">            |
  |-- GET /media/... ------------>|-- 302 to presigned GET (1 h) ----->|
```

- **Stored value:** `/media/<folder>/<uploaderUserId>/<uuid>.<ext>`. The frontend renders it the same way as the old `/uploads/...` paths (`VITE_MEDIA_URL + path`).
- **Size and type** are signed into the PUT URL, so S3 rejects any upload that doesn't match. The API checks them again with HEAD when the form is saved.
- **Ownership:** a form can only attach paths issued to the user who submits it.
- **Old files:** existing `/uploads/...` rows keep working, served from disk as before. When a record is replaced or deleted, its old file is removed, whether it is on S3 or on disk.

### Scopes (`src/config/upload.config.js`)

| Scope            | Folder     | Types                                 | Max            |
|------------------|------------|---------------------------------------|----------------|
| `profile`        | `users`    | jpg, png, webp, gif                   | 5 MB           |
| `agent-document` | `agents`   | jpg, png, webp, gif, pdf              | 10 MB          |
| `bank-document`  | `bank`     | jpg, png, pdf                         | 5 MB           |
| `review-media`   | `reviews`  | jpg, png, webp, mp4, mov, webm        | 25 MB, 5 files |
| `package-media`  | `packages` | jpg, png, webp, gif, mp4, mov, webm, avi, mkv | 25 MB, 20 files |

To raise a limit (for example, longer package videos), change `maxBytes` here. The file no longer passes through the API, so a larger limit costs the server nothing.

## Setup

### 1. Environment variables

Copy the keys from `.env.example`:

| Variable                | Required | Notes |
|-------------------------|----------|-------|
| `AWS_REGION`            | yes      | e.g. `ap-south-1` |
| `AWS_S3_BUCKET_NAME`    | yes      | |
| `AWS_ACCESS_KEY_ID`     | no       | Leave empty on EC2/ECS to use the IAM role |
| `AWS_SECRET_ACCESS_KEY` | no       | |

When these variables are unset, the presign and `/media` endpoints return `503 File uploads are not configured`.

### 2. Bucket

Keep **Block all public access** on. Every read goes through a presigned URL.

**CORS** (Permissions → CORS). List every frontend origin that uploads:

```json
[
  {
    "AllowedOrigins": ["https://mytraveltown.com", "http://localhost:5173"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type", "x-amz-tagging"],
    "MaxAgeSeconds": 3000
  }
]
```

**Lifecycle rule** (Management → Create lifecycle rule). This removes files that were uploaded but never saved with a form:

- Filter: object tag `upload-status` = `pending`
- Action: expire current versions of objects **1 day** after creation

### 3. IAM policy for the API

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectTagging",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:DeleteObjectTagging"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

`s3:PutObjectTagging` is required because each upload sets the pending tag. HEAD requests are covered by `s3:GetObject`.

### 4. Reverse proxy

`GET /media/*` is served by Node at the site root, next to `/uploads/*`. If Apache only forwards some paths to Node, forward `/media/` as well.

## API

### `POST /api/uploads/presign` (auth, rate limited: 150 per 15 min per IP)

```json
// request
{ "scope": "package-media", "contentType": "video/mp4", "contentLength": 5000000 }

// 200
{
  "success": true,
  "message": "Upload URL created",
  "data": {
    "uploadUrl": "https://<bucket>.s3.<region>.amazonaws.com/packages/12/<uuid>.mp4?X-Amz-...",
    "method": "PUT",
    "headers": { "Content-Type": "video/mp4", "x-amz-tagging": "upload-status=pending" },
    "path": "/media/packages/12/<uuid>.mp4",
    "expiresIn": 300
  }
}

// 400: { "success": false, "message": "Only image or video files are allowed", "data": null }
```

Send `headers` with the PUT exactly as returned. The frontend helper is `src/lib/upload.ts` (`uploadFile`, `uploadFiles`, `uploadOptionalFile`).

### Form fields that now take paths instead of files

| Endpoint                     | Field(s)                                                   |
|------------------------------|------------------------------------------------------------|
| `PUT /api/auth/update-profile` | `profile`                                                |
| `POST /api/agents`, `PUT /api/agents/me` | `aadhar`, `aadhar_back`, `dl`, `dl_back`, `company_document` |
| `PUT /api/bank/bank-details` | `bank_document`                                            |
| `POST /api/reviews/package/:id` | `media`: JSON array of paths                            |
| `POST /api/packages`, `PUT /api/packages/:id` | `gallery`: JSON array of paths            |

These endpoints accept JSON or multipart text fields. A multipart request that still contains a file gets a 400.

### `GET /media/<key>` (public, rate limited: 3000 per 15 min per IP)

Returns a 302 redirect to a presigned GET URL that is valid for 1 hour. The redirect is cached by the browser for 5 minutes. Malformed keys return 404.

## Old `/uploads` files

Rows created before S3 still store `/uploads/...` paths. The database was **not** changed. Instead, each file is copied to S3 under the same path (`/uploads/agents/x.png` becomes the key `uploads/agents/x.png`), and `GET /uploads/*` serves the file in this order:

1. The S3 copy, through a 302 to a presigned URL. Whether a file exists in S3 is cached in memory for 1 hour (5 minutes for misses).
2. The local file in `./uploads`. This is also used whenever S3 is unconfigured or errors.
3. `MEDIA_FALLBACK_URL`, for local development only.

Deleting a record removes both the local file and its S3 copy.

### Migration script

```bash
node scripts/migrate-uploads-to-s3.js scan     # read-only: count /uploads paths in the DB
node scripts/migrate-uploads-to-s3.js backup   # DB dump + every file -> ./backups/uploads-<timestamp>/
node scripts/migrate-uploads-to-s3.js upload   # copy the latest backup to S3 (skips files already there)
node scripts/migrate-uploads-to-s3.js verify   # every DB path exists in S3?
```

Every command can be re-run. Run `backup` and then `upload` again after deploying, to pick up files uploaded to the server's disk in the meantime. `./backups` is git-ignored. It contains identity documents, so move it to secure storage and delete the local copy when you are done.

To roll back, remove the `legacyUploadsRouter` line in `src/app.js`. Files are then served from disk again.

## Known trade-offs

- Anyone who has a `/media/...` path can view that file. The same was true of the old public `/uploads` folder, but the new keys are random UUIDs instead of guessable names. Gating KYC and bank documents to admins and their owner would require loading them through an authenticated request (with a blob URL) instead of a plain `<img src>`.
- Uploads show a saving state but no progress percentage. If large videos need a progress bar, switch the PUT in `src/lib/upload.ts` to `XMLHttpRequest` and use `upload.onprogress`.
