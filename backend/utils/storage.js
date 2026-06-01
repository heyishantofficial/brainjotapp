const path = require('path');
const fs = require('fs');
const { S3Client, DeleteObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const logger = require('./logger');

const UPLOADS_DIR = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');

const useR2 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

const s3 = useR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
}) : null;

async function deleteStoredFile(fileRecord) {
  if (useR2) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileRecord.file }));
    } catch (err) {
      const code = err?.name || err?.Code;
      // Suppress "file already gone" — surface everything else (auth errors, throttling, network)
      if (code !== 'NoSuchKey' && code !== 'NotFound') {
        logger.error({ key: fileRecord.file, code, message: err.message }, '[storage] R2 delete failed');
        // Hook point: Sentry.captureException(err, { extra: { key: fileRecord.file } });
      }
    }
  } else {
    const fp = path.join(UPLOADS_DIR, fileRecord.file);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

// Delete all files belonging to a user (projects + tasks + avatar).
// Accepts an array of project documents (lean objects).
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
          Bucket: process.env.R2_BUCKET_NAME,
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
    ? `${process.env.R2_PUBLIC_URL}/${key}`
    : `uploads/${key}`;
}

module.exports = { UPLOADS_DIR, useR2, s3, deleteStoredFile, deleteUserFiles, filePublicUrl };
