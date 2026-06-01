const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const { S3Client, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { SignatureV4 } = require('@smithy/signature-v4');
const logger = require('./logger');

const UPLOADS_DIR = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');

// Trim to guard against Railway env vars with accidental trailing whitespace/newlines
const R2_ACCOUNT_ID        = (process.env.R2_ACCOUNT_ID        || '').trim();
const R2_ACCESS_KEY_ID     = (process.env.R2_ACCESS_KEY_ID     || '').trim();
const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const R2_BUCKET_NAME       = (process.env.R2_BUCKET_NAME       || '').trim();
const R2_PUBLIC_URL        = (process.env.R2_PUBLIC_URL        || '').trim();

const useR2 = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

// S3Client is used only for delete operations.
// Uploads use a manually-signed https.request (see uploadLocalFileToR2).
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
  }, '[storage] R2 configured');
}

// SHA-256 implementation backed by Node.js built-in crypto.
// Required by @smithy/signature-v4 which needs a HashConstructor.
class NodeSha256 {
  constructor() { this._h = crypto.createHash('sha256'); }
  update(data, enc) {
    if (typeof data === 'string') this._h.update(data, enc || 'utf8');
    else this._h.update(data);
  }
  digest() { return Promise.resolve(this._h.digest()); }
}

// Upload a file to R2.
//
// WHY we bypass the AWS SDK's S3Client for this operation:
// Despite forcePathStyle:true, @aws-sdk/client-s3 v3 rewrites the URL to
// virtual-hosted style  →  {bucket}.{accountId}.r2.cloudflarestorage.com
// Cloudflare only has a cert for *.r2.cloudflarestorage.com (one wildcard level),
// so {bucket}.{accountId}.r2.cloudflarestorage.com has NO valid cert and every
// TLS handshake fails with ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE (alert 40).
//
// Fix: build the URL ourselves (always path-style), sign with SigV4 via
// @smithy/signature-v4 (already a transitive dep), then send with https.request.
// The target hostname  →  {accountId}.r2.cloudflarestorage.com  matches the cert.
async function uploadLocalFileToR2(localPath, key, mimeType) {
  const body = fs.readFileSync(localPath);
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  // Encode each path segment but preserve the slash separator
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const urlPath = `/${R2_BUCKET_NAME}/${encodedKey}`;
  const contentType = mimeType || 'application/octet-stream';

  logger.info({ host, urlPath, size: body.length }, '[storage] R2 upload start');

  const signer = new SignatureV4({
    service: 's3',
    region: 'auto',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    sha256: NodeSha256,
  });

  const signed = await signer.sign({
    method: 'PUT',
    hostname: host,
    protocol: 'https:',
    path: urlPath,
    headers: {
      host,
      'content-type': contentType,
      'content-length': String(body.length),
    },
    body,
  });

  // Remove 'host' from signed.headers — Node.js https sets it from `hostname`
  // and a duplicate can cause request issues.
  const { host: _h, ...reqHeaders } = signed.headers;

  await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, port: 443, path: urlPath, method: 'PUT', headers: reqHeaders },
      (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          res.resume();
          logger.info({ host, urlPath, status: res.statusCode }, '[storage] R2 upload ok');
          return resolve();
        }
        let errData = '';
        res.on('data', d => { errData += d; });
        res.on('end', () => {
          const msg = `R2 HTTP ${res.statusCode}: ${errData.slice(0, 300)}`;
          logger.error({ host, urlPath, status: res.statusCode, body: errData.slice(0, 300) }, '[storage] R2 upload failed');
          reject(new Error(msg));
        });
      },
    );
    req.on('error', (err) => {
      logger.error({ host, urlPath, code: err.code, message: err.message }, '[storage] R2 upload network error');
      reject(err);
    });
    req.write(body);
    req.end();
  });

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
