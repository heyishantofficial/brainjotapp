const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { S3Client, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const logger = require('./logger');

const UPLOADS_DIR = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');

// The account ID must be the bare 32-hex-char ID — if a full S3 endpoint URL was
// pasted into the env var, extract the ID so the built hostname stays valid
// (a malformed hostname fails TLS with ERR_SSL_VERSION_OR_CIPHER_MISMATCH)
function normalizeAccountId(raw) {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\.?r2\.cloudflarestorage\.com.*$/i, '')
    .replace(/[/?#].*$/, '')
    .trim();
}
const R2_ACCOUNT_ID        = normalizeAccountId((process.env.R2_ACCOUNT_ID || '').trim());
const R2_ACCESS_KEY_ID     = (process.env.R2_ACCESS_KEY_ID     || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET_NAME       = (process.env.R2_BUCKET_NAME       || '').trim();
const R2_PUBLIC_URL        = (process.env.R2_PUBLIC_URL        || '').trim();

const useR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

// S3Client is used only for delete operations.
// Uploads use browser-direct presigned URLs (see getPresignedPutUrl).
const s3 = useR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  forcePathStyle: true,
}) : null;

if (useR2) {
  logger.info({
    host: `${R2_ACCOUNT_ID.slice(0, 6)}***.r2.cloudflarestorage.com`,
    bucket: R2_BUCKET_NAME,
    mode: 'presigned-url (browser-direct)',
  }, '[storage] R2 configured');
  if (!/^[0-9a-f]{32}(\.eu)?$/i.test(R2_ACCOUNT_ID)) {
    logger.warn({ accountIdPrefix: R2_ACCOUNT_ID.slice(0, 8) }, '[storage] R2_ACCOUNT_ID does not look like a valid Cloudflare account ID (expected 32 hex chars) — uploads will fail TLS');
  }
}

// Generate a presigned PUT URL for browser-direct upload.
// Hand-rolled SigV4 query auth (pure local computation, no network call):
// the @smithy/signature-v4 presigner produced signatures R2 rejects with
// SignatureDoesNotMatch, while this spec-exact implementation verifies.
// Only content-type-agnostic headers are signed (host), so the browser can
// send any Content-Type. Query params must stay in sorted order — the
// canonical request requires it and R2 recomputes it from the raw URL.
async function getPresignedPutUrl(key, _mimeType, expiresIn = 300) {
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const urlPath = `/${R2_BUCKET_NAME}/${encodedKey}`;

  const longDate = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const shortDate = longDate.slice(0, 8);
  const scope = `${shortDate}/auto/s3/aws4_request`;
  const params = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${R2_ACCESS_KEY_ID}/${scope}`],
    ['X-Amz-Date', longDate],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = `PUT\n${urlPath}\n${qs}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const stringToSign = `AWS4-HMAC-SHA256\n${longDate}\n${scope}\n${crypto.createHash('sha256').update(canonical).digest('hex')}`;
  const hmac = (k, m) => crypto.createHmac('sha256', k).update(m).digest();
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + R2_SECRET_ACCESS_KEY, shortDate), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  logger.info({ key, expiresIn }, '[storage] presigned PUT URL generated');
  return `https://${host}${urlPath}?${qs}&X-Amz-Signature=${signature}`;
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

module.exports = { UPLOADS_DIR, useR2, s3, getPresignedPutUrl, deleteStoredFile, deleteUserFiles, filePublicUrl };
