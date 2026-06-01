const path = require('path');
const fs = require('fs');
const { S3Client, DeleteObjectCommand, DeleteObjectsCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { FetchHttpHandler } = require('@smithy/fetch-http-handler');
const logger = require('./logger');

const UPLOADS_DIR = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');

// Trim to guard against Railway env vars with accidental trailing whitespace/newlines
const R2_ACCOUNT_ID     = (process.env.R2_ACCOUNT_ID     || '').trim();
const R2_ACCESS_KEY_ID  = (process.env.R2_ACCESS_KEY_ID  || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET_NAME    = (process.env.R2_BUCKET_NAME    || '').trim();
const R2_PUBLIC_URL     = (process.env.R2_PUBLIC_URL     || '').trim();

const useR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

// Use FetchHttpHandler (undici-backed) instead of the default NodeHttpHandler to
// avoid TLS handshake failures that affect the Node.js http module with some
// Cloudflare R2 endpoints in containerised environments.
const s3 = useR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  requestHandler: new FetchHttpHandler(),
}) : null;

if (useR2) {
  logger.info({ endpoint: `https://${R2_ACCOUNT_ID.slice(0, 6)}***.r2.cloudflarestorage.com`, bucket: R2_BUCKET_NAME }, '[storage] R2 configured');
}

// Upload a local file to R2 and delete the local copy on success.
// Returns the R2 key on success, throws on failure.
// Uses readFileSync (Buffer) so FetchHttpHandler/undici gets a known-length body
// rather than a Node.js ReadStream which fetch doesn't handle reliably.
async function uploadLocalFileToR2(localPath, key, mimeType) {
  const body = fs.readFileSync(localPath);
  try {
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: mimeType || 'application/octet-stream',
      ContentLength: body.length,
    }));
  } catch (err) {
    // Unwrap undici's "fetch failed" TypeError to expose the real cause
    // e.g. ENOTFOUND (bad account ID), EPROTO (SSL), ECONNREFUSED, etc.
    const cause = err.cause;
    const detail = cause
      ? `[${cause.code || cause.name || '?'}] ${cause.message || ''}`.trim()
      : err.message;
    logger.error({ key, endpoint: `https://${R2_ACCOUNT_ID.slice(0, 6)}***.r2.cloudflarestorage.com`, bucket: R2_BUCKET_NAME, cause: detail }, '[storage] R2 upload error');
    throw new Error(detail || err.message);
  }
  try { fs.unlinkSync(localPath); } catch { /* ignore cleanup error */ }
  return key;
}

async function deleteStoredFile(fileRecord) {
  if (useR2) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: fileRecord.file }));
    } catch (err) {
      const code = err?.name || err?.Code;
      if (code !== 'NoSuchKey' && code !== 'NotFound') {
        logger.error({ key: fileRecord.file, code, message: err.message }, '[storage] R2 delete failed');
      }
    }
  } else {
    const fp = path.join(UPLOADS_DIR, fileRecord.file);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

async function deleteUserFiles(userId, projects = []) {
  const keys = [];
  for (const proj of projects) {
    for (const f of proj.files || []) keys.push(f.file);
    for (const t of proj.tasks || []) {
      for (const f of t.files || []) keys.push(f.file);
    }
  }
  keys.push(`avatars/${userId}.jpg`);

  if (useR2) {
    const chunks = [];
    for (let i = 0; i < keys.length; i += 1000) chunks.push(keys.slice(i, i + 1000));
    for (const chunk of chunks) {
      try {
        await s3.send(new DeleteObjectsCommand({
          Bucket: R2_BUCKET_NAME,
          Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
        }));
      } catch (err) {
        const code = err?.name || err?.Code;
        if (code !== 'NoSuchKey' && code !== 'NotFound') {
          logger.error({ keyCount: chunk.length, code, message: err.message }, '[storage] R2 bulk delete failed');
        }
      }
    }
  } else {
    for (const key of keys) {
      const fp = path.join(UPLOADS_DIR, key);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  }
}

function filePublicUrl(key) {
  return useR2
    ? `${R2_PUBLIC_URL}/${key}`
    : `uploads/${key}`;
}

module.exports = { UPLOADS_DIR, useR2, s3, uploadLocalFileToR2, deleteStoredFile, deleteUserFiles, filePublicUrl };
