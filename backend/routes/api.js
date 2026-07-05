const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const dns = require('dns').promises;
const disposableDomains = new Set(require('disposable-email-domains'));
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const Project = require('../models/Project');
const Space = require('../models/Space');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const Notification = require('../models/Notification');
const Otp = require('../models/Otp');
const Invite = require('../models/Invite');
const LoginAttempt = require('../models/LoginAttempt');
const { OAuth2Client } = require('google-auth-library');
const { UPLOADS_DIR, useR2, getPresignedPutUrl, deleteStoredFile, deleteUserFiles, filePublicUrl } = require('../utils/storage');
const { livekitEnabled, ActiveCall, generateToken, removeParticipant, LIVEKIT_URL } = require('../utils/livekit');
const logger = require('../utils/logger');

const router = express.Router();

// ── OTP security helpers ──────────────────────────────────────────
// SESSION_SECRET is required in production so it's a safe HMAC key.
const OTP_SECRET = process.env.SESSION_SECRET || 'brainjot-dev-otp-fallback';
function hashOtp(code) {
  return crypto.createHmac('sha256', OTP_SECRET).update(String(code)).digest('hex');
}
function verifyOtp(submitted, storedHash) {
  if (!storedHash) return false;
  try {
    const a = Buffer.from(hashOtp(String(submitted)), 'hex');
    const b = Buffer.from(storedHash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// One-way hash of IP before storing — IP is PII under GDPR.
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip || '').digest('hex').slice(0, 16);
}

// HIBP k-anonymity check — fails open (returns false) if API is unreachable.
function checkPwnedPassword(password) {
  const hash = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  return new Promise((resolve) => {
    const req = https.get(
      { hostname: 'api.pwnedpasswords.com', path: `/range/${prefix}`, timeout: 3000,
        headers: { 'Add-Padding': 'true', 'User-Agent': 'BrainJot-Auth/1.0' } },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data.split('\r\n').some(l => l.split(':')[0] === suffix)));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function emitProjectUpdate(req, projectId) {
  req.app.get('io')?.to(`project:${projectId}`).emit('project_updated', { projectId });
}

const VALID_COLLAB_ROLES = ['editor', 'viewer'];
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isValidColor(c) { return typeof c === 'string' && HEX_COLOR_RE.test(c); }
function safeIcon(icon, fallback = '📁') { return typeof icon === 'string' ? [...icon].slice(0, 4).join('') || fallback : fallback; }
const APP_URL = process.env.APP_URL || 'https://brainjotapp.up.railway.app';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const FROM_EMAIL = process.env.FROM_EMAIL || 'BrainJot <onboarding@resend.dev>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendInviteEmail({ to, toName, inviterName, projectTitle, spaceTitle }) {
  if (!resend) {
    logger.warn({ to }, '[email] RESEND_API_KEY not configured — skipping invite');
    return;
  }
  const subjectTarget = projectTitle ? `project "${projectTitle}"` : `space "${spaceTitle}"`;
  const displayTarget = projectTitle || spaceTitle;
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: `${inviterName} invited you to collaborate on BrainJot`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;border-radius:16px">
          <h1 style="font-size:28px;font-weight:800;margin:0 0 8px">🧠 BrainJot</h1>
          <p style="color:#888;font-size:14px;margin:0 0 32px">Your brain at a glance</p>

          <p style="font-size:16px;line-height:1.6;margin:0 0 24px">
            Hey${toName ? ` ${toName}` : ''},<br><br>
            <strong>${inviterName}</strong> has invited you to collaborate on the ${subjectTarget}.
          </p>

          <a href="${APP_URL}" style="display:inline-block;background:#7C6FCD;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px">
            Open ${displayTarget} in BrainJot →
          </a>

          <p style="font-size:13px;color:#666;margin:32px 0 0;line-height:1.6">
            If you don't have a BrainJot account yet, click the link above to sign up for free.<br>
            Once logged in, ask ${inviterName} to re-invite you so the collaboration is linked to your account.
          </p>
        </div>
      `,
    });
    logger.info({ to, messageId: result?.id }, '[email] invite_sent');
  } catch (err) {
    logger.error({ to, message: err.message, status: err.statusCode }, '[email] invite_failed');
    // Hook point: Sentry.captureException(err, { extra: { to } });
  }
}

const SALT_ROUNDS = 12;
const MAX_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB per user

// ── Multer setup ──────────────────────────────────────────────────
const ALLOWED_EXT = new Set([
  'jpg','jpeg','png','gif','webp','pdf',
  'doc','docx','xls','xlsx','ppt','pptx',
  'mp4','mov','zip','txt','csv',
]);

// Allowed MIME types for general uploads (maps extension category → allowed MIME prefixes)
const ALLOWED_MIME_PREFIXES = new Set([
  'image/', 'video/', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats',
  'application/vnd.ms-', 'application/zip', 'text/',
]);

function makeKey(taskId, projectId, ext) {
  const prefix = taskId ? `task_${taskId}_` : `${projectId}_`;
  return `${prefix}${crypto.randomUUID()}.${ext}`;
}

// Always save to disk first. If R2 is configured, the handler manually pushes
// the file to R2 after multer writes it locally and then deletes the temp copy.
// This avoids multerS3 streaming directly to R2, which caused SSL handshake
// failures in containerised environments.
const diskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    cb(null, UPLOADS_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    cb(null, `tmp_${crypto.randomUUID()}.${ext}`);
  },
});

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mimeOk = [...ALLOWED_MIME_PREFIXES].some(p => file.mimetype.startsWith(p));
    if (ALLOWED_EXT.has(ext) && mimeOk) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const avatarDiskStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const dir = path.join(UPLOADS_DIR, 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, _file, cb) => cb(null, `${req.session.userId}.jpg`),
});
const ALLOWED_AVATAR_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);
const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const uploadAvatar = multer({
  storage: avatarDiskStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ALLOWED_AVATAR_EXT.has(ext) && ALLOWED_AVATAR_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error('Avatar must be a JPG, PNG, WebP, or GIF image'));
  },
});

function conditionalUpload(req, res, next) {
  const action = req.query.action;
  // In R2 mode, file uploads are browser-direct via presigned URLs — no server-side
  // multipart handling needed. Skip multer entirely and let the route handlers respond.
  if (useR2 && (action === 'upload' || action === 'upload_task_file' || action === 'upload_avatar')) {
    return next();
  }
  if (action === 'upload' || action === 'upload_task_file') {
    upload.single('file')(req, res, (err) => {
      if (!err) return next();
      const multer = require('multer');
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 50MB)' });
        return res.status(400).json({ error: err.message });
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
    });
  } else if (action === 'upload_avatar') {
    uploadAvatar.single('file')(req, res, (err) => {
      if (!err) return next();
      const multer = require('multer');
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Avatar too large (max 2MB)' });
        return res.status(400).json({ error: err.message });
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
    });
  } else {
    next();
  }
}

// ── Helpers ───────────────────────────────────────────────────────
function uid() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 13);
}

function now() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

function toPlain(docs) {
  return docs.map(doc => {
    const obj = doc.toObject ? doc.toObject() : doc;
    const { _id, __v, ...rest } = obj;
    return rest;
  });
}

function cloneTaskForDuplicate(task) {
  const { _id, id, ...rest } = task.toObject ? task.toObject() : task;
  return { ...rest, id: 'task_' + uid(), files: [] };
}

// ── Seed default data per user ────────────────────────────────────
async function seedDefaultData(userId) {
  const spaceCount = await Space.countDocuments({ ownerId: userId });
  let defaultSpaceId;

  if (spaceCount === 0) {
    const workId = 'space_' + uid();
    const personalId = 'space_' + uid();
    await Space.create({ id: workId,     title: 'Work',     icon: '💼', color: '#3b82f6', description: 'Professional projects',   ownerId: userId, __orderRank: 0 });
    await Space.create({ id: personalId, title: 'Personal', icon: '🏠', color: '#10b981', description: 'Personal goals & projects', ownerId: userId, __orderRank: 1 });
    defaultSpaceId = workId;
  } else {
    const first = await Space.findOne({ ownerId: userId }).sort({ __orderRank: 1 });
    defaultSpaceId = first.id;
  }

  const projectCount = await Project.countDocuments({ ownerId: userId });
  if (projectCount > 0) return;

  const defaults = [
    {
      id: 'proj_' + uid(), title: 'My First Project', subtitle: 'Get started with BrainJot',
      color: '#7C6FCD', tag: 'Project',
      tasks: [
        { id: 'task_' + uid(), text: 'Create your first task', badge: 'Getting Started' },
        { id: 'task_' + uid(), text: 'Add a deadline to a task', badge: 'Getting Started' },
        { id: 'task_' + uid(), text: 'Explore Spaces in the sidebar', badge: 'Getting Started' },
      ],
    },
  ];

  for (let i = 0; i < defaults.length; i++) {
    const d = defaults[i];
    await Project.create({
      ...d,
      spaceId: defaultSpaceId,
      ownerId: userId,
      notes: '',
      richNotes: '',
      files: [],
      collaborators: [],
      __orderRank: i,
      tasks: d.tasks.map(t => ({
        ...t,
        done: false,
        notes: '',
        richNotes: '',
        files: [],
        deadline: '',
        assignee: '',
        priority: '',
      })),
    });
  }
}

// ── MongoDB-backed rate limit store ──────────────────────────────
// Shared across all server instances — safe for horizontal scaling.
// Falls back gracefully (allows request through) if DB is unreachable.
class MongoRateLimitStore {
  constructor(windowMs, collectionName = 'rate_limits') {
    this.windowMs = windowMs;
    this.collectionName = collectionName;
  }
  get col() {
    return mongoose.connection.db?.collection(this.collectionName);
  }
  async increment(key) {
    if (!this.col) return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    const now = new Date();
    const resetTime = new Date(now.getTime() + this.windowMs);
    try {
      const doc = await this.col.findOneAndUpdate(
        { key, resetTime: { $gt: now } },
        { $inc: { totalHits: 1 }, $setOnInsert: { key, resetTime } },
        { upsert: true, returnDocument: 'after' }
      );
      return { totalHits: doc.totalHits, resetTime: doc.resetTime };
    } catch {
      return { totalHits: 1, resetTime };
    }
  }
  async decrement(key) {
    if (!this.col) return;
    await this.col.updateOne({ key }, { $inc: { totalHits: -1 } }).catch(() => {});
  }
  async resetKey(key) {
    if (!this.col) return;
    await this.col.deleteOne({ key }).catch(() => {});
  }
}

// ── Rate limiters ─────────────────────────────────────────────────
// Auth limiter uses MongoDB so the 20-attempt window is shared across all instances.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new MongoRateLimitStore(15 * 60 * 1000, 'rate_limits_auth'),
  handler: (req, res) => {
    logger.warn({ ip: req.ip, action: req.query.action }, '[rate_limit] auth limiter triggered');
    res.status(429).json({ error: 'Too many attempts, please try again later' });
  },
});

// Per-user rate limit for all authenticated API actions
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, userId: req.session?.userId, action: req.query.action }, '[rate_limit] api limiter triggered');
    res.status(429).json({ error: 'Too many requests, please slow down' });
  },
});

// Strict rate limit for data export (5 per hour per user)
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.session?.userId || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn({ ip: req.ip, userId: req.session?.userId }, '[rate_limit] export limiter triggered');
    res.status(429).json({ error: 'Export limit reached, please try again later' });
  },
});

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Community SSO token ───────────────────────────────────────────
// Mints a short-lived JWT that the standalone community app
// (community.brainjot.space) verifies LOCALLY to start its own session. This is
// the ONLY endpoint the community ever calls on the main app — at most once per
// login — so the community carries its own traffic without loading this app.
// Signed with COMMUNITY_JWT_SECRET, a secret shared only between the two backends.
router.get('/community/sso-token', requireAuth, async (req, res) => {
  const secret = process.env.COMMUNITY_JWT_SECRET;
  if (!secret) return res.status(503).json({ error: 'Community SSO not configured' });
  const user = await User.findOne({ id: req.session.userId })
    .select('id name username email avatarUrl role -_id').lean();
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const token = jwt.sign(
    {
      sub: user.id,
      name: user.name,
      username: user.username || '',
      email: user.email || '',
      avatarUrl: user.avatarUrl || '',
      role: user.role || 'user',
    },
    secret,
    { issuer: 'brainjot-app', audience: 'brainjot-community', expiresIn: '2m' },
  );
  res.json({ token });
});

// ── Download helper ───────────────────────────────────────────────
router.get('/download', requireAuth, (req, res) => {
  const fileUrl = req.query.url;
  const originalName = req.query.name;

  if (!fileUrl) return res.status(400).send('File URL is required');

  // R2 files have a full HTTPS public URL — only redirect to our own R2 bucket domain.
  // Use strict hostname comparison instead of string prefix to prevent subdomain bypass attacks.
  if (fileUrl.startsWith('https://')) {
    const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';
    if (!R2_PUBLIC_URL) return res.status(400).send('Invalid file URL');
    try {
      const allowedHost = new URL(R2_PUBLIC_URL).hostname;
      const requestedHost = new URL(fileUrl).hostname;
      if (!allowedHost || requestedHost !== allowedHost) {
        return res.status(400).send('Invalid file URL');
      }
    } catch {
      return res.status(400).send('Invalid file URL');
    }
    return res.redirect(fileUrl);
  }

  // Local dev: serve from disk
  const filename = path.basename(fileUrl);
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!filePath.startsWith(UPLOADS_DIR + path.sep)) {
    return res.status(400).send('Invalid file path');
  }
  if (fs.existsSync(filePath)) {
    res.download(filePath, originalName || filename);
  } else {
    res.status(404).send('File not found');
  }
});

router.use(conditionalUpload);

// ── GET routes ────────────────────────────────────────────────────
router.get('/', apiLimiter, async (req, res) => {
  const action = req.query.action;

  if (action === 'check_username') {
    const raw = (req.query.username || '').toLowerCase().trim();
    if (!raw || raw.length < 3) { res.json({ available: false, error: 'Username must be at least 3 characters' }); return; }
    if (raw.length > 20) { res.json({ available: false, error: 'Username must be 20 characters or less' }); return; }
    if (!/^[a-z0-9_]+$/.test(raw)) { res.json({ available: false, error: 'Only letters, numbers and underscores allowed' }); return; }
    const exists = await User.findOne({ username: raw });
    res.json({ available: !exists });
    return;
  }

  if (action === 'check') {
    const response = {
      loggedIn: false,
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      features: { livekit: livekitEnabled }
    };
    if (req.session.userId) {
      const user = await User.findOne({ id: req.session.userId }).select('name email username role avatarUrl -_id');
      if (user) {
        req.session.userRole = user.role || 'user';
        response.loggedIn = true;
        response.user = { id: req.session.userId, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' };
      }
    }
    res.json(response);
    return;
  }

  if (!req.session.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const userId = req.session.userId;

  if (action === 'find_user') {
    const q = (req.query.q || '').replace(/^@/, '').toLowerCase().trim();
    if (q.length < 2) { res.json({ users: [] }); return; }
    const safeQ = q.replace(/[^a-z0-9_]/g, '');
    // C-4: do not expose the internal user id — username is the public handle used for invites.
    const users = await User.find({ username: { $regex: '^' + safeQ }, id: { $ne: userId } })
      .select('name username avatarUrl -_id').limit(8).lean();
    res.json({ users });
    return;
  }

  if (action === 'get_notifications') {
    const notifs = await Notification.find({ toUserId: userId })
      .sort({ createdAt: -1 }).limit(50).lean();
    res.json({ notifications: notifs.map(({ _id, __v, ...n }) => n) });
    return;
  }

  if (action === 'get') {
    // Keep session role in sync with DB so revocations take effect within one poll cycle
    const freshUser = await User.findOne({ id: userId }).select('role -_id').lean();
    if (freshUser) req.session.userRole = freshUser.role || 'user';
    const spaces   = await Space.find({ ownerId: userId }).sort({ __orderRank: 1 }).select('-_id -__v');
    const projects = await Project.find({ ownerId: userId }).sort({ __orderRank: 1 }).select('-_id -__v');
    // Also fetch projects in owned spaces that were created by space collaborators
    const ownedSpaceIds = toPlain(spaces).map(s => s.id).filter(Boolean);
    const spaceEditorProjectDocs = ownedSpaceIds.length
      ? await Project.find({ spaceId: { $in: ownedSpaceIds }, ownerId: { $ne: userId } }).select('-_id -__v').lean()
      : [];
    const sharedProjectDocs = await Project.find({ 'collaborators.userId': userId, ownerId: { $ne: userId } }).select('-_id -__v').lean();
    const sharedSpaceDocs   = await Space.find({ 'collaborators.userId': userId, ownerId: { $ne: userId } }).select('-_id -__v').lean();
    // Fetch projects belonging to shared spaces so the SpaceView can render them
    const sharedSpaceIds = sharedSpaceDocs.map(s => s.id).filter(Boolean);
    const sharedSpaceProjectDocs = sharedSpaceIds.length
      ? await Project.find({ spaceId: { $in: sharedSpaceIds } }).select('-_id -__v').lean()
      : [];
    // Look up owner info so collaborators can @mention the owner in comments
    const allOwnerIds = [...new Set([...sharedProjectDocs.map(p => p.ownerId), ...sharedSpaceDocs.map(s => s.ownerId)])].filter(Boolean);
    const ownerUsers = allOwnerIds.length ? await User.find({ id: { $in: allOwnerIds } }).select('id name username avatarUrl -_id').lean() : [];
    const ownerMap = Object.fromEntries(ownerUsers.map(u => [u.id, u]));
    const annotateShared = (items) => items.map(item => {
      const me = (item.collaborators || []).find(c => c.userId === userId);
      const ownerUser = ownerMap[item.ownerId];
      const ownerInfo = ownerUser ? { userId: item.ownerId, name: ownerUser.name, username: ownerUser.username || '', avatarUrl: ownerUser.avatarUrl || '' } : null;
      return { ...item, myRole: me?.role || 'viewer', ownerInfo };
    });
    res.json({
      spaces: toPlain(spaces),
      // Merge collaborator-created projects in owned spaces so they appear in the space view
      projects: [...toPlain(projects), ...spaceEditorProjectDocs],
      sharedProjects: annotateShared(sharedProjectDocs),
      sharedSpaces: annotateShared(sharedSpaceDocs).map(s => ({
        ...s,
        projects: sharedSpaceProjectDocs.filter(p => p.spaceId === s.id),
      })),
    });
    return;
  }

  if (action === 'get_feedback') {
    const isAdmin = req.session.userRole === 'superadmin';
    const raw = await Feedback.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      items: raw.map(({ _id, __v, upvotes, userId: feedbackUserId, userName, ...rest }) => ({
        ...rest,
        // Only admins see who submitted each item — prevents exposing submitter names to all users
        ...(isAdmin ? { userId: feedbackUserId, userName } : {}),
        upvoteCount: upvotes.length,
        hasUpvoted: upvotes.includes(userId),
      })),
    });
    return;
  }

  if (action === 'get_task_comments') {
    const { projectId, taskId } = req.query;
    if (!projectId || !taskId) { res.status(400).json({ error: 'Missing data' }); return; }
    const proj = await Project.findOne({
      id: projectId,
      $or: [{ ownerId: userId }, { 'collaborators.userId': userId }],
    }).select('tasks -_id').lean();
    if (!proj) { res.status(404).json({ error: 'Not found' }); return; }
    const taskDoc = (proj.tasks || []).find(t => t.id === taskId);
    res.json({ comments: taskDoc?.comments || [] });
    return;
  }

  // ── get_upload_url ──────────────────────────────────────────────
  // Returns a presigned PUT URL so the browser uploads directly to R2.
  // In disk mode, returns { diskMode: true } — frontend falls back to multipart.
  if (action === 'get_upload_url') {
    if (!useR2) { res.json({ ok: true, diskMode: true }); return; }

    const { filename, mimeType, size, type, projectId, taskId } = req.query;
    if (!filename || !type) { res.status(400).json({ error: 'filename and type required' }); return; }

    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const maxBytes = type === 'avatar' ? 2 * 1024 * 1024 : 50 * 1024 * 1024;
    if (size && Number(size) > maxBytes) {
      return res.status(400).json({ error: type === 'avatar' ? 'Avatar too large (max 2MB)' : 'File too large (max 50MB)' });
    }

    if (type === 'avatar') {
      if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) {
        return res.status(400).json({ error: 'Avatar must be jpg/png/webp/gif' });
      }
    } else {
      if (!ALLOWED_EXT.has(ext)) return res.status(400).json({ error: 'File type not allowed' });
      // Enforce per-user storage quota before issuing a presigned URL
      const uploader = await User.findOne({ id: userId }).select('storageUsedBytes -_id').lean();
      const usedBytes = uploader?.storageUsedBytes || 0;
      const requestedBytes = Number(size) || 0;
      if (usedBytes + requestedBytes > MAX_STORAGE_BYTES) {
        return res.status(413).json({ error: `Storage quota exceeded. You have used ${Math.round(usedBytes / 1024 / 1024)} MB of your ${Math.round(MAX_STORAGE_BYTES / 1024 / 1024)} MB limit.` });
      }
    }

    let key;
    if (type === 'avatar') {
      key = `avatars/${userId}.jpg`;
    } else if (type === 'task') {
      if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId required' });
      // Verify the user has editor access before issuing a presigned URL (prevents storage cost abuse)
      const taskAccess = await Project.exists({
        id: projectId,
        'tasks.id': taskId,
        $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }],
      });
      if (!taskAccess) return res.status(403).json({ error: 'No editor access to this task' });
      key = makeKey(taskId, projectId, ext);
    } else {
      if (!projectId) return res.status(400).json({ error: 'projectId required' });
      // Verify editor access before issuing a presigned URL
      const projAccess = await Project.exists({
        id: projectId,
        $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }],
      });
      if (!projAccess) return res.status(403).json({ error: 'No editor access to this project' });
      key = makeKey(null, projectId, ext);
    }

    const fileId = uid();
    const uploadUrl = await getPresignedPutUrl(key, mimeType || 'application/octet-stream');
    logger.info({ userId, type, key, fileId }, '[upload] presigned URL issued');
    res.json({ ok: true, uploadUrl, fileKey: key, fileId });
    return;
  }

  // ── get_call_token ── (GET because it's called from frontend as GET)
  if (action === 'get_call_token') {
    if (!livekitEnabled) { res.status(400).json({ error: 'Calling is not configured on this server' }); return; }
    const { projectId, spaceId, callType = 'audio' } = req.query;
    if (!projectId && !spaceId) { res.status(400).json({ error: 'projectId or spaceId required' }); return; }
    if (!['audio', 'video'].includes(callType)) { res.status(400).json({ error: 'Invalid callType' }); return; }

    const callId = projectId || spaceId;
    const entityType = projectId ? 'project' : 'space';

    if (projectId) {
      const project = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId } } }] });
      if (!project) { res.status(404).json({ error: 'Project not found or access denied' }); return; }
    } else {
      const space = await Space.findOne({ id: spaceId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId } } }] });
      if (!space) { res.status(404).json({ error: 'Space not found or access denied' }); return; }
    }

    const user = await User.findOne({ id: userId }).select('name');
    const userName = user?.name || 'Host';
    const roomName = `call_${entityType}_${callId}`;
    const socketRoom = `${entityType}:${callId}`;

    const existingCall = await ActiveCall.findOne({ callId }).lean();
    if (!existingCall) {
      await ActiveCall.create({ callId, hostUserId: userId, hostName: userName, callType, roomName, entityType });
      req.app.get('io')?.to(socketRoom).emit('call:started', { callId, entityType, hostUserId: userId, hostName: userName, callType });
      logger.info({ callId, entityType, userId, callType }, '[call] started');
    }

    const token = await generateToken(userId, userName, roomName);
    res.json({ ok: true, token, roomName, livekitUrl: LIVEKIT_URL });
    return;
  }

  res.status(404).json({ error: 'Unknown action' });
});

// ── POST routes ───────────────────────────────────────────────────
router.post('/', apiLimiter, async (req, res, next) => {
  const action = req.query.action;

  // ── register (disabled — all signups must go through register_otp) ──
  if (action === 'register') {
    return res.status(410).json({ error: 'This endpoint is no longer available. Please sign up using the email verification flow.' });
  }

  // ── login ──
  if (action === 'login') {
    return authLimiter(req, res, async () => {
      try {
        const { email, password } = req.body;
        if (!email?.trim() || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }
        const cleanEmail = email.toLowerCase().trim();

        // Per-email brute force protection: lock out after 10 consecutive failures for 1 hour
        const MAX_LOGIN_FAILURES = 10;
        const attemptDoc = await LoginAttempt.findOne({ email: cleanEmail });
        if (attemptDoc && attemptDoc.count >= MAX_LOGIN_FAILURES) {
          logger.warn({ ip: req.ip, email: cleanEmail }, '[auth] login_blocked — per-email lockout');
          return res.status(429).json({ error: 'Too many failed attempts. Try again in an hour or use email OTP to sign in.' });
        }

        const user = await User.findOne({ email: cleanEmail });
        if (!user) {
          logger.warn({ ip: req.ip, reason: 'unknown_email' }, '[auth] login_failure');
          // Still increment attempt counter on unknown email to prevent timing-based enumeration
          await LoginAttempt.findOneAndUpdate(
            { email: cleanEmail },
            { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) } },
            { upsert: true }
          );
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
          logger.warn({ ip: req.ip, userId: user.id, reason: 'wrong_password' }, '[auth] login_failure');
          await LoginAttempt.findOneAndUpdate(
            { email: cleanEmail },
            { $inc: { count: 1 }, $set: { expiresAt: new Date(Date.now() + 60 * 60 * 1000) } },
            { upsert: true }
          );
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Successful login — clear failure counter
        await LoginAttempt.deleteOne({ email: cleanEmail });

        // Auto-elevate if email is in ADMIN_EMAILS
        if (ADMIN_EMAILS.includes(user.email) && user.role !== 'superadmin') {
          await User.updateOne({ id: user.id }, { role: 'superadmin' });
          user.role = 'superadmin';
        }
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
        req.session.userId = user.id;
        req.session.userRole = user.role || 'user';
        logger.info({ userId: user.id, ip: req.ip, role: user.role }, '[auth] login_success');
        res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── google_auth ──
  if (action === 'google_auth') {
    return authLimiter(req, res, async () => {
      try {
        const { credential, consentGiven } = req.body;
        if (!credential) {
          return res.status(400).json({ error: 'Google credential is required' });
        }
        
        if (!process.env.GOOGLE_CLIENT_ID) {
          logger.error('[auth] GOOGLE_CLIENT_ID environment variable is not set');
          return res.status(500).json({ error: 'Google authentication is not configured on this server.' });
        }
        
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        let ticket;
        try {
          ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
          });
        } catch (tokenErr) {
          logger.error({ err: tokenErr }, '[auth] google ID token verification failed');
          return res.status(401).json({ error: 'Invalid Google credential token' });
        }
        
        const payload = ticket.getPayload();
        const { email, name, picture } = payload;
        
        if (!email) {
          return res.status(400).json({ error: 'Email not provided by Google' });
        }
        
        const cleanEmail = email.toLowerCase().trim();
        let user = await User.findOne({ email: cleanEmail });
        const role = ADMIN_EMAILS.includes(cleanEmail) ? 'superadmin' : 'user';
        
        if (!user) {
          // F6: new users must give explicit consent — existing users already gave it at signup
          if (!consentGiven) {
            return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy to create an account.' });
          }
          // Register a new user
          const baseUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15).toLowerCase();
          let finalUsername = baseUsername || 'user';
          let suffix = 1;
          while (await User.findOne({ username: finalUsername })) {
            finalUsername = `${baseUsername}${suffix}`;
            suffix++;
          }
          
          const newUserId = 'user_' + uid();
          user = await User.create({
            id: newUserId,
            email: cleanEmail,
            name: name || 'Google User',
            username: finalUsername,
            passwordHash: 'GOOGLE_OAUTH_USER',
            role,
            avatarUrl: picture || '',
            consentGiven: true,
            consentAt: new Date(),
            consentVersion: '1.0',
            consentIp: hashIp(req.ip),  // F16: hash IP — it's PII under GDPR
          });
          await seedDefaultData(newUserId);
        } else {
          // Check if updates are needed
          let updated = false;
          const updates = {};
          if (!user.avatarUrl && picture) {
            updates.avatarUrl = picture;
            updated = true;
          }
          if (ADMIN_EMAILS.includes(user.email) && user.role !== 'superadmin') {
            updates.role = 'superadmin';
            updated = true;
          }
          if (updated) {
            await User.updateOne({ id: user.id }, updates);
            Object.assign(user, updates);
          }
        }
        
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
        req.session.userId = user.id;
        req.session.userRole = user.role || 'user';
        
        logger.info({ userId: user.id, ip: req.ip, role: user.role }, '[auth] google_login_success');
        res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── send_otp ──
  if (action === 'send_otp') {
    return authLimiter(req, res, async () => {
      try {
        const { email } = req.body;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
          return res.status(400).json({ error: 'Invalid email address' });
        }
        
        if (!resend) {
          logger.warn({ to: email }, '[email] RESEND_API_KEY not configured — skipping OTP');
          return res.status(500).json({ error: 'Email service (Resend) is not configured on this server.' });
        }
        
        const cleanEmail = email.toLowerCase().trim();
        const emailDomain = cleanEmail.split('@')[1];

        // Block known disposable/temporary email domains
        if (disposableDomains.has(emailDomain)) {
          return res.status(400).json({ error: 'Temporary or disposable email addresses are not allowed. Please use a real email address.' });
        }

        // F20: MX check with 3-second timeout; fails open on DNS errors so legitimate
        // domains with slow/unusual DNS configs are not blocked.
        try {
          const mx = await Promise.race([
            dns.resolveMx(emailDomain),
            new Promise((_, rej) => setTimeout(() => rej(new Error('DNS_TIMEOUT')), 3000)),
          ]);
          if (!mx || mx.length === 0) {
            return res.status(400).json({ error: 'This email domain does not appear to accept mail. Please use a valid email address.' });
          }
        } catch (dnsErr) {
          if (dnsErr.code === 'ENOTFOUND' || dnsErr.code === 'ENODATA') {
            return res.status(400).json({ error: 'This email domain does not appear to accept mail. Please use a valid email address.' });
          }
          // Timeout or unknown DNS error — allow through and log for monitoring
          logger.warn({ emailDomain, err: dnsErr.message }, '[send_otp] MX check skipped — allowing through');
        }

        // Enforce 60-second resend cooldown per email to prevent OTP flooding
        const existingOtp = await Otp.findOne({ email: cleanEmail });
        if (existingOtp?.lastSentAt && (Date.now() - existingOtp.lastSentAt.getTime()) < 60 * 1000) {
          return res.status(429).json({ error: 'Please wait before requesting another code' });
        }

        // F1: crypto.randomInt is CSPRNG — Math.random() is not
        const otpCode = crypto.randomInt(100000, 1000000).toString();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

        // F2: store HMAC hash of code, never plaintext
        await Otp.findOneAndUpdate(
          { email: cleanEmail },
          { codeHash: hashOtp(otpCode), expiresAt, attempts: 0, lastSentAt: new Date() },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        
        await resend.emails.send({
          from: FROM_EMAIL,
          to: cleanEmail,
          subject: `Your BrainJot Verification Code: ${otpCode}`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;border-radius:16px">
              <h1 style="font-size:28px;font-weight:800;margin:0 0 8px">🧠 BrainJot</h1>
              <p style="color:#888;font-size:14px;margin:0 0 32px">Your brain at a glance</p>

              <h2 style="font-size:20px;margin:0 0 16px">Verify Your Email</h2>
              <p style="font-size:16px;line-height:1.6;margin:0 0 24px">
                Use the following verification code to sign in to your BrainJot account. This code is valid for 5 minutes.
              </p>

              <div style="background:#1e1e1e;border:1px solid #333;padding:16px;border-radius:12px;text-align:center;font-size:32px;font-weight:800;letter-spacing:6px;color:#D4FF32;margin-bottom:24px">
                ${otpCode}
              </div>

              <p style="font-size:13px;color:#666;margin:32px 0 0;line-height:1.6">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </div>
          `,
        });
        
        logger.info({ email: cleanEmail }, '[email] otp_sent');
        // Do not reveal whether the email has a registered account (prevents enumeration)
        res.json({ ok: true });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── verify_otp ──
  if (action === 'verify_otp') {
    return authLimiter(req, res, async () => {
      try {
        const { email, otp } = req.body;
        if (!email || !otp) {
          return res.status(400).json({ error: 'Email and OTP are required' });
        }
        // F17: reject obviously malformed codes before hitting the DB
        if (!/^\d{6}$/.test(otp.trim())) {
          return res.status(400).json({ error: 'Verification code must be 6 digits' });
        }

        const cleanEmail = email.toLowerCase().trim();

        // Look up OTP by email first so we can apply the attempt counter
        const otpDoc = await Otp.findOne({ email: cleanEmail });

        if (!otpDoc || otpDoc.expiresAt < new Date()) {
          return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }

        // Kill the OTP after 5 wrong guesses to prevent brute force
        const MAX_OTP_ATTEMPTS = 5;
        if ((otpDoc.attempts || 0) >= MAX_OTP_ATTEMPTS) {
          await Otp.deleteOne({ _id: otpDoc._id });
          return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
        }

        // F2: compare against HMAC hash, not plaintext
        if (!verifyOtp(otp.trim(), otpDoc.codeHash)) {
          otpDoc.attempts = (otpDoc.attempts || 0) + 1;
          await otpDoc.save();
          const remaining = MAX_OTP_ATTEMPTS - otpDoc.attempts;
          return res.status(400).json({ error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        }

        const user = await User.findOne({ email: cleanEmail });
        if (!user) {
          // OTP is valid but no account yet — frontend handles profile creation step.
          // Do NOT delete OTP here; register_otp will verify and consume it.
          res.json({ ok: true, verified: true, exists: false });
          return;
        }

        await Otp.deleteOne({ _id: otpDoc._id });
        
        if (ADMIN_EMAILS.includes(user.email) && user.role !== 'superadmin') {
          await User.updateOne({ id: user.id }, { role: 'superadmin' });
          user.role = 'superadmin';
        }
        
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
        req.session.userId = user.id;
        req.session.userRole = user.role || 'user';
        
        logger.info({ userId: user.id, ip: req.ip, role: user.role }, '[auth] otp_login_success');
        res.json({ ok: true, verified: true, exists: true, user: { id: user.id, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── register_otp ──
  if (action === 'register_otp') {
    return authLimiter(req, res, async () => {
      try {
        const { email, name, username, otp, consentGiven } = req.body;
        if (!email || !name || !username || !otp) {
          return res.status(400).json({ error: 'All fields are required' });
        }
        if (!consentGiven) {
          return res.status(400).json({ error: 'You must agree to the Terms of Service and Privacy Policy to create an account' });
        }
        
        const cleanEmail = email.toLowerCase().trim();
        // F17: format check
        if (!/^\d{6}$/.test(otp?.trim())) {
          return res.status(400).json({ error: 'Verification code must be 6 digits' });
        }
        // F2: look up by email, compare hash
        const otpDoc = await Otp.findOne({ email: cleanEmail });
        if (!otpDoc || otpDoc.expiresAt < new Date() || !verifyOtp(otp.trim(), otpDoc.codeHash)) {
          return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }

        const existing = await User.findOne({ email: cleanEmail });
        if (existing) {
          return res.status(400).json({ error: 'Account already exists. Please login.' });
        }

        const cleanUsername = username.toLowerCase().trim();
        if (cleanUsername.length < 3 || cleanUsername.length > 20 || !/^[a-z0-9_]+$/.test(cleanUsername)) {
          return res.status(400).json({ error: 'Username must be 3-20 chars, letters/numbers/underscores only' });
        }
        const takenUsername = await User.findOne({ username: cleanUsername });
        if (takenUsername) {
          return res.status(409).json({ error: 'Username already taken' });
        }

        await Otp.deleteOne({ _id: otpDoc._id });

        const newUserId = 'user_' + uid();
        const role = ADMIN_EMAILS.includes(cleanEmail) ? 'superadmin' : 'user';
        const user = await User.create({
          id: newUserId,
          email: cleanEmail,
          name: name.trim().slice(0, 100),  // F19: cap name length
          username: cleanUsername,
          passwordHash: 'OTP_AUTH_USER',
          role,
          avatarUrl: '',
          consentGiven: true,
          consentAt: new Date(),
          consentVersion: '1.0',
          consentIp: hashIp(req.ip),  // F16: hash IP before storing
        });
        
        await seedDefaultData(newUserId);
        
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
        req.session.userId = newUserId;
        req.session.userRole = role;
        
        logger.info({ userId: newUserId, ip: req.ip, role }, '[auth] register_otp_success');
        res.json({ ok: true, user: { id: newUserId, name: user.name, email: user.email, username: user.username, role, avatarUrl: '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── reset_password_via_otp ──
  // Lets a password-based user reset a forgotten password by proving email ownership via OTP.
  // Also accepts OTP/Google users who want to set a password for the first time.
  if (action === 'reset_password_via_otp') {
    return authLimiter(req, res, async () => {
      try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
          return res.status(400).json({ error: 'Email, OTP and new password are required' });
        }
        if (newPassword.length < 8) {
          return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (newPassword.length > 256) {
          return res.status(400).json({ error: 'Password too long (max 256 characters)' });
        }
        if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
          return res.status(400).json({ error: 'Password must contain at least one uppercase letter and one number' });
        }
        // F17: format check
        if (!/^\d{6}$/.test(otp?.trim())) {
          return res.status(400).json({ error: 'Verification code must be 6 digits' });
        }
        const cleanEmail = email.toLowerCase().trim();
        const otpDoc = await Otp.findOne({ email: cleanEmail });
        if (!otpDoc || otpDoc.expiresAt < new Date()) {
          return res.status(400).json({ error: 'Invalid or expired OTP code' });
        }
        const MAX_OTP_ATTEMPTS = 5;
        if ((otpDoc.attempts || 0) >= MAX_OTP_ATTEMPTS) {
          await Otp.deleteOne({ _id: otpDoc._id });
          return res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' });
        }
        // F2: compare hash
        if (!verifyOtp(otp.trim(), otpDoc.codeHash)) {
          otpDoc.attempts = (otpDoc.attempts || 0) + 1;
          await otpDoc.save();
          const remaining = MAX_OTP_ATTEMPTS - otpDoc.attempts;
          return res.status(400).json({ error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` });
        }
        const user = await User.findOne({ email: cleanEmail });
        if (!user) {
          return res.status(404).json({ error: 'No account found for this email' });
        }
        // F8: HIBP breach check — fail open so network issues don't block resets
        const pwned = await checkPwnedPassword(newPassword);
        if (pwned) {
          return res.status(400).json({ error: 'This password has appeared in known data breaches. Please choose a different password.' });
        }
        await Otp.deleteOne({ _id: otpDoc._id });
        await User.updateOne({ id: user.id }, { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) });
        logger.info({ userId: user.id, ip: req.ip }, '[auth] reset_password_via_otp');
        // F18: invalidate all other sessions so a compromised old session can't be reused after reset
        const db = mongoose.connection.db;
        const stale = await db.collection('sessions').find(
          { session: { $regex: `"userId":"${user.id}"` } },
          { projection: { _id: 1 } }
        ).toArray();
        if (stale.length) await db.collection('sessions').deleteMany({ _id: { $in: stale.map(s => s._id) } });
        // Create a fresh session
        await new Promise((resolve, reject) => req.session.regenerate(e => e ? reject(e) : resolve()));
        req.session.userId = user.id;
        req.session.userRole = user.role || 'user';
        res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── logout ──
  if (action === 'logout') {
    req.session.destroy(() => res.json({ ok: true }));
    return;
  }

  if (!req.session.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const userId = req.session.userId;

  // ── get_profile_stats ──
  if (action === 'get_profile_stats') {
    const user = await User.findOne({ id: userId }).select('name email username role avatarUrl createdAt -_id');
    const [projects, spaces, feedbackCount] = await Promise.all([
      Project.find({ ownerId: userId }).lean(),
      Space.find({ ownerId: userId }).lean(),
      Feedback.countDocuments({ userId }),
    ]);
    let taskTotal = 0, taskDone = 0, fileCount = 0;
    projects.forEach(p => {
      (p.tasks || []).forEach(t => { taskTotal++; if (t.done) taskDone++; });
      fileCount += (p.files || []).length;
    });
    res.json({
      user: { name: user.name, email: user.email, username: user.username || '', role: user.role, avatarUrl: user.avatarUrl || '', createdAt: user.createdAt },
      stats: {
        projectCount: projects.length,
        spaceCount: spaces.length,
        taskTotal, taskDone,
        taskOpen: taskTotal - taskDone,
        completionRate: taskTotal ? Math.round(taskDone / taskTotal * 100) : 0,
        fileCount, feedbackCount,
      },
    });
    return;
  }

  // ── update_profile ──
  if (action === 'update_profile') {
    const { name } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Nothing to update' }); return; }
    const updates = { name: name.trim().slice(0, 100) };
    await User.updateOne({ id: userId }, updates);
    res.json({ ok: true, name: updates.name });
    return;
  }

  // ── request_email_change ── (F13)
  // Step 1: send OTP to the NEW email to prove ownership before committing the change.
  if (action === 'request_email_change') {
    if (!resend) { res.status(500).json({ error: 'Email service not configured' }); return; }
    const { newEmail } = req.body;
    if (!newEmail?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) {
      res.status(400).json({ error: 'Invalid email address' }); return;
    }
    const cleanNew = newEmail.toLowerCase().trim();
    const currentUser = await User.findOne({ id: userId }).select('email -_id').lean();
    if (cleanNew === currentUser?.email) { res.status(400).json({ error: 'That is already your current email' }); return; }
    const taken = await User.findOne({ email: cleanNew, id: { $ne: userId } });
    if (taken) { res.status(409).json({ error: 'That email is already in use by another account' }); return; }
    const domain = cleanNew.split('@')[1];
    if (disposableDomains.has(domain)) { res.status(400).json({ error: 'Temporary email addresses are not allowed' }); return; }
    const cooldown = await Otp.findOne({ email: cleanNew });
    if (cooldown?.lastSentAt && (Date.now() - cooldown.lastSentAt.getTime()) < 60 * 1000) {
      res.status(429).json({ error: 'Please wait before requesting another code' }); return;
    }
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await Otp.findOneAndUpdate(
      { email: cleanNew },
      { codeHash: hashOtp(otpCode), expiresAt, attempts: 0, lastSentAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await resend.emails.send({
      from: FROM_EMAIL, to: cleanNew,
      subject: `Verify your new BrainJot email: ${otpCode}`,
      html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;border-radius:16px"><h1 style="font-size:24px;font-weight:800;margin:0 0 16px">Verify your new email</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px">Use this code to confirm your new email address on BrainJot. It expires in 5 minutes.</p><div style="background:#1e1e1e;border:1px solid #333;padding:16px;border-radius:12px;text-align:center;font-size:32px;font-weight:800;letter-spacing:6px;color:#D4FF32;margin-bottom:24px">${otpCode}</div><p style="font-size:13px;color:#666;margin:0;line-height:1.6">If you didn't request this, you can safely ignore it.</p></div>`,
    });
    logger.info({ userId, newEmail: cleanNew }, '[auth] email_change_otp_sent');
    res.json({ ok: true });
    return;
  }

  // ── confirm_email_change ── (F13)
  // Step 2: verify OTP sent to new email, then commit the change.
  if (action === 'confirm_email_change') {
    const { newEmail, otp } = req.body;
    if (!newEmail?.trim() || !otp?.trim()) { res.status(400).json({ error: 'New email and code are required' }); return; }
    if (!/^\d{6}$/.test(otp.trim())) { res.status(400).json({ error: 'Verification code must be 6 digits' }); return; }
    const cleanNew = newEmail.toLowerCase().trim();
    const taken = await User.findOne({ email: cleanNew, id: { $ne: userId } });
    if (taken) { res.status(409).json({ error: 'That email is already in use' }); return; }
    const otpDoc = await Otp.findOne({ email: cleanNew });
    if (!otpDoc || otpDoc.expiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired verification code' }); return;
    }
    // C-2: cap brute-force guesses, consistent with the other OTP flows
    const MAX_OTP_ATTEMPTS = 5;
    if ((otpDoc.attempts || 0) >= MAX_OTP_ATTEMPTS) {
      await Otp.deleteOne({ _id: otpDoc._id });
      res.status(400).json({ error: 'Too many incorrect attempts. Request a new code.' }); return;
    }
    if (!verifyOtp(otp.trim(), otpDoc.codeHash)) {
      otpDoc.attempts = (otpDoc.attempts || 0) + 1;
      await otpDoc.save();
      const remaining = MAX_OTP_ATTEMPTS - otpDoc.attempts;
      res.status(400).json({ error: `Invalid code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` }); return;
    }
    // Capture the old address before overwriting so we can warn it of the change
    const before = await User.findOne({ id: userId }).select('email -_id').lean();
    await Otp.deleteOne({ _id: otpDoc._id });
    await User.updateOne({ id: userId }, { email: cleanNew });
    logger.info({ userId, newEmail: cleanNew, ip: req.ip }, '[auth] email_changed');
    // C-2: fire-and-forget security notice to the previous email (account-takeover safety net).
    // Never blocks or fails the response.
    if (resend && before?.email && before.email !== cleanNew) {
      resend.emails.send({
        from: FROM_EMAIL, to: before.email,
        subject: 'Your BrainJot email address was changed',
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;border-radius:16px"><h1 style="font-size:22px;font-weight:800;margin:0 0 16px">Email address changed</h1><p style="font-size:15px;line-height:1.6;margin:0 0 16px">The email on your BrainJot account was just changed to <strong>${cleanNew}</strong>.</p><p style="font-size:15px;line-height:1.6;margin:0">If this wasn't you, your account may be compromised — contact support immediately.</p></div>`,
      }).catch((err) => logger.warn({ err: err?.message, userId }, '[auth] email_change notice failed'));
    }
    res.json({ ok: true, email: cleanNew });
    return;
  }

  // ── logout_all ── (F12)
  if (action === 'logout_all') {
    const db = mongoose.connection.db;
    await db.collection('sessions').deleteMany({ session: { $regex: `"userId":"${userId}"` } });
    req.session.destroy(() => res.json({ ok: true }));
    return;
  }

  // ── upload_avatar (disk mode only — R2 uses get_upload_url + confirm_upload) ──
  if (action === 'upload_avatar') {
    if (useR2) return res.status(400).json({ error: 'R2 mode: use get_upload_url + confirm_upload' });
    if (!req.file) { res.status(400).json({ error: 'No file received' }); return; }
    // Same-key overwrite — version the URL so browsers refetch the new image
    const avatarUrl = `${filePublicUrl(`avatars/${userId}.jpg`)}?v=${Date.now()}`;
    await User.updateOne({ id: userId }, { avatarUrl });
    res.json({ ok: true, avatarUrl });
    return;
  }

  // ── change_password ──
  if (action === 'change_password') {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Both passwords required' }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }
    if (newPassword.length > 256) { res.status(400).json({ error: 'Password too long (max 256 characters)' }); return; }
    // C-5: match the complexity rule enforced at signup and password reset
    if (!/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) { res.status(400).json({ error: 'Password must contain at least one uppercase letter and one number' }); return; }
    const user = await User.findOne({ id: userId });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    // OTP and Google OAuth accounts have no password — give a clear error instead of a silent failure
    if (user.passwordHash === 'OTP_AUTH_USER' || user.passwordHash === 'GOOGLE_OAUTH_USER') {
      return res.status(400).json({ error: 'Your account uses email OTP or Google Sign-In and does not have a password to change.' });
    }
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) { res.status(401).json({ error: 'Current password is incorrect' }); return; }
    // F8: HIBP breach check — fail open on network issues
    const pwned = await checkPwnedPassword(newPassword);
    if (pwned) { res.status(400).json({ error: 'This password has appeared in known data breaches. Please choose a different one.' }); return; }
    await User.updateOne({ id: userId }, { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) });
    logger.info({ userId, ip: req.ip }, '[audit] change_password');
    // Invalidate all other active sessions so stolen cookies can't be used after a password change.
    // Filter at MongoDB level with a regex on the serialized JSON — avoids O(N) full collection scan in Node.
    const db = mongoose.connection.db;
    const staleSessions = await db.collection('sessions').find(
      { session: { $regex: `"userId":"${userId}"` }, _id: { $ne: req.sessionID } },
      { projection: { _id: 1 } }
    ).toArray();
    const toDelete = staleSessions.map(s => s._id);
    if (toDelete.length) await db.collection('sessions').deleteMany({ _id: { $in: toDelete } });
    res.json({ ok: true });
    return;
  }

  // ── delete_account ──
  if (action === 'delete_account') {
    const { password } = req.body;
    const user = await User.findOne({ id: userId });
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }
    // OTP and Google OAuth users have no password — they are already authenticated via session
    const isPasswordlessAccount = user.passwordHash === 'OTP_AUTH_USER' || user.passwordHash === 'GOOGLE_OAUTH_USER';
    if (!isPasswordlessAccount) {
      if (!password) { res.status(400).json({ error: 'Password required' }); return; }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) { res.status(401).json({ error: 'Incorrect password' }); return; }
    }
    // Delete all stored files before removing documents
    const userProjects = await Project.find({ ownerId: userId }).select('files tasks').lean();
    logger.info({ userId, ip: req.ip, projectCount: userProjects.length }, '[audit] delete_account');
    await deleteUserFiles(userId, userProjects);
    await Promise.all([
      User.deleteOne({ id: userId }),
      Project.deleteMany({ ownerId: userId }),
      Space.deleteMany({ ownerId: userId }),
      Feedback.deleteMany({ userId }),
      // Remove this user from collaborator lists on projects/spaces they didn't own
      Project.updateMany({ 'collaborators.userId': userId }, { $pull: { collaborators: { userId } } }),
      Space.updateMany({ 'collaborators.userId': userId }, { $pull: { collaborators: { userId } } }),
      // Remove pending notifications to/from this user
      Notification.deleteMany({ $or: [{ toUserId: userId }, { fromUserId: userId }] }),
    ]);
    req.session.destroy(() => res.json({ ok: true }));
    return;
  }

  // ── export_data ──
  if (action === 'export_data') {
    return exportLimiter(req, res, async () => {
      const [projects, spaces] = await Promise.all([
        Project.find({ ownerId: userId }).select('-_id -__v').lean(),
        Space.find({ ownerId: userId }).select('-_id -__v').lean(),
      ]);
      res.json({ spaces, projects, exportedAt: new Date().toISOString() });
    });
  }

  // ── post_feedback ──
  if (action === 'post_feedback') {
    const { message, type = 'general' } = req.body;
    if (!message?.trim()) { res.status(400).json({ error: 'Message required' }); return; }
    const user = await User.findOne({ id: userId }).select('name -_id');
    const item = await Feedback.create({
      id: 'fb_' + uid(),
      userId,
      userName: user?.name || 'Anonymous',
      message: message.trim().slice(0, 500),
      type: ['bug','idea','general'].includes(type) ? type : 'general',
      status: 'open',
      upvotes: [],
    });
    const { _id, __v, upvotes, ...rest } = item.toObject();
    res.json({ ok: true, item: { ...rest, upvoteCount: 0, hasUpvoted: false } });
    return;
  }

  // ── toggle_feedback_status ──
  if (action === 'toggle_feedback_status') {
    if (req.session.userRole !== 'superadmin') { res.status(403).json({ error: 'Forbidden' }); return; }
    const { feedbackId } = req.body;
    const item = await Feedback.findOne({ id: feedbackId });
    if (!item) { res.status(404).json({ error: 'Not found' }); return; }
    item.status = item.status === 'open' ? 'fixed' : 'open';
    await item.save();
    res.json({ ok: true, status: item.status });
    return;
  }

  // ── upvote_feedback ──
  if (action === 'upvote_feedback') {
    const { feedbackId } = req.body;
    const existing = await Feedback.findOne({ id: feedbackId }).select('upvotes -_id').lean();
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const alreadyUpvoted = existing.upvotes.includes(userId);
    const updated = await Feedback.findOneAndUpdate(
      { id: feedbackId },
      alreadyUpvoted ? { $pull: { upvotes: userId } } : { $addToSet: { upvotes: userId } },
      { new: true, select: 'upvotes -_id' }
    );
    res.json({ ok: true, upvoteCount: updated.upvotes.length, hasUpvoted: !alreadyUpvoted });
    return;
  }

  // ── add_project ──
  if (action === 'add_project') {
    const { title, subtitle = '', color = '#888785', tag = 'Project', spaceId = '' } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: 'Title required' }); return; }
    if (!isValidColor(color)) { res.status(400).json({ error: 'Invalid color format' }); return; }
    const totalProjects = await Project.countDocuments({ ownerId: userId });
    if (totalProjects >= 200) { res.status(429).json({ error: 'Project limit reached (200 max)' }); return; }
    if (spaceId) {
      const ownedSpace = await Space.findOne({ id: spaceId, ownerId: userId });
      if (!ownedSpace) {
        const editorSpace = await Space.findOne({ id: spaceId, collaborators: { $elemMatch: { userId, role: 'editor' } } });
        if (!editorSpace) { res.status(403).json({ error: 'No editor access to this space' }); return; }
      }
    }
    const newId = 'proj_' + uid();
    const count = await Project.countDocuments({ spaceId, ownerId: userId });
    const initialCollaborators = [];
    // If creating in a space the user doesn't own, auto-add the space owner as editor collaborator
    if (spaceId) {
      const parentSpace = await Space.findOne({ id: spaceId, ownerId: { $ne: userId } }).select('ownerId -_id').lean();
      if (parentSpace) {
        const spaceOwner = await User.findOne({ id: parentSpace.ownerId }).select('id name email username avatarUrl -_id').lean();
        if (spaceOwner) {
          initialCollaborators.push({ id: 'collab_' + uid(), userId: spaceOwner.id, name: spaceOwner.name, email: spaceOwner.email || '', username: spaceOwner.username || '', avatarUrl: spaceOwner.avatarUrl || '', role: 'editor', status: 'active' });
        }
      }
    }
    await Project.create({ id: newId, title: title.trim().slice(0, 200), subtitle: subtitle.toString().trim().slice(0, 300), color, tag: tag.toString().trim().slice(0, 50) || 'Project', spaceId, ownerId: userId, tasks: [], notes: '', richNotes: '', files: [], collaborators: initialCollaborators, __orderRank: count });
    res.json({ ok: true, id: newId });
    return;
  }

  // ── rename_project ──
  if (action === 'rename_project') {
    const { projectId, title, subtitle, tag, color } = req.body;
    if (!projectId || !title?.trim()) { res.status(400).json({ error: 'Missing data' }); return; }
    const update = { title: title.trim().slice(0, 200) };
    if (subtitle !== undefined) update.subtitle = subtitle.toString().trim().slice(0, 300);
    if (tag !== undefined) update.tag = tag.toString().trim().slice(0, 50) || 'Project';
    if (color !== undefined) {
      if (!isValidColor(color)) { res.status(400).json({ error: 'Invalid color format' }); return; }
      update.color = color;
    }
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: update });
    res.json({ ok: true });
    return;
  }

  // ── duplicate_project ──
  if (action === 'duplicate_project') {
    const { projectId } = req.body;
    const source = await Project.findOne({ id: projectId, ownerId: userId }).lean();
    if (!source) { res.status(404).json({ error: 'Project not found' }); return; }
    const totalProjects = await Project.countDocuments({ ownerId: userId });
    if (totalProjects >= 200) { res.status(429).json({ error: 'Project limit reached (200 max)' }); return; }
    const dupId = 'proj_' + uid();
    const { _id, __v, id, ...rest } = source;
    await Project.create({
      ...rest,
      id: dupId,
      title: (rest.title || 'Project') + ' Copy',
      ownerId: userId,
      files: [],
      tasks: (rest.tasks || []).map(cloneTaskForDuplicate),
    });
    res.json({ ok: true, id: dupId });
    return;
  }

  // ── copy_project (cross-space copy) ──
  if (action === 'copy_project') {
    const { projectId, spaceId: targetSpaceId } = req.body;
    if (!projectId || !targetSpaceId) { res.status(400).json({ error: 'Missing data' }); return; }
    const source = await Project.findOne({ id: projectId, ownerId: userId }).lean();
    if (!source) { res.status(404).json({ error: 'Project not found' }); return; }
    const totalProjects = await Project.countDocuments({ ownerId: userId });
    if (totalProjects >= 200) { res.status(429).json({ error: 'Project limit reached (200 max)' }); return; }
    const space = await Space.findOne({ id: targetSpaceId, ownerId: userId });
    if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
    const { _id, __v, id, ...rest } = source;
    const newId = 'proj_' + uid();
    await Project.create({
      ...rest,
      id: newId,
      spaceId: targetSpaceId,
      title: (rest.title || 'Project') + ' (Copy)',
      ownerId: userId,
      files: [],
      tasks: (rest.tasks || []).map(cloneTaskForDuplicate),
    });
    res.json({ ok: true, id: newId });
    return;
  }

  // ── move_project (cross-space move) ──
  if (action === 'move_project') {
    const { projectId, spaceId: targetSpaceId } = req.body;
    if (!projectId || !targetSpaceId) { res.status(400).json({ error: 'Missing data' }); return; }
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const space = await Space.findOne({ id: targetSpaceId, ownerId: userId });
    if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
    proj.spaceId = targetSpaceId;
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── delete_project ──
  if (action === 'delete_project') {
    const { projectId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId }).lean();
    if (proj) {
      logger.info({ userId, projectId, title: proj.title, taskCount: (proj.tasks || []).length }, '[audit] delete_project');
      for (const f of proj.files || []) await deleteStoredFile(f);
      for (const t of proj.tasks || []) { for (const f of t.files || []) await deleteStoredFile(f); }
    }
    await Project.deleteOne({ id: projectId, ownerId: userId });
    res.json({ ok: true });
    return;
  }

  // ── archive_project ──
  if (action === 'archive_project') {
    const { projectId } = req.body;
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: { archived: true } });
    res.json({ ok: true });
    return;
  }

  // ── unarchive_project ──
  if (action === 'unarchive_project') {
    const { projectId } = req.body;
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: { archived: false } });
    res.json({ ok: true });
    return;
  }

  // ── clear_project_tasks ──
  if (action === 'clear_project_tasks') {
    const { projectId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    logger.info({ userId, projectId, taskCount: proj.tasks.length }, '[audit] clear_project_tasks');
    for (const t of proj.tasks || []) { for (const f of t.files || []) await deleteStoredFile(f); }
    proj.tasks = [];
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── invite_collaborator (DEPRECATED) ──
  // This endpoint bypasses identity verification and the token-based invite flow.
  // Use send_collab_invite instead — it generates a secure token, sends a verified email,
  // and creates an in-app notification for existing users.
  if (action === 'invite_collaborator') {
    return res.status(410).json({
      error: 'This endpoint is deprecated. Use action=send_collab_invite instead.',
      useInstead: 'send_collab_invite',
    });
  }

  // ── remove_collaborator ──
  if (action === 'remove_collaborator') {
    const { projectId, collaboratorId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    logger.info({ userId, projectId, collaboratorId }, '[audit] remove_collaborator');
    // Capture the removed collaborator's userId before filtering so we can evict them from any active call
    const removedCollab = proj.collaborators.find(c => c.id === collaboratorId);
    proj.collaborators = proj.collaborators.filter(c => c.id !== collaboratorId);
    proj.tasks.forEach(t => {
      if (t.assignee === collaboratorId) t.assignee = '';
      if (Array.isArray(t.assignees)) t.assignees = t.assignees.filter(a => a !== collaboratorId);
    });
    await proj.save();
    // Evict the removed collaborator from any active LiveKit call for this project
    if (livekitEnabled && removedCollab?.userId) {
      const activeCall = await ActiveCall.findOne({ callId: projectId }).lean();
      if (activeCall) await removeParticipant(activeCall.roomName, removedCollab.userId);
    }
    res.json({ ok: true });
    return;
  }

  // ── update_collaborator_role ──
  if (action === 'update_collaborator_role') {
    const { projectId, collaboratorId, role } = req.body;
    if (!projectId || !collaboratorId || !role) { res.status(400).json({ error: 'Missing data' }); return; }
    if (!VALID_COLLAB_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const collab = proj.collaborators.find(c => c.id === collaboratorId);
    if (!collab) { res.status(404).json({ error: 'Collaborator not found' }); return; }
    collab.role = role;
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── task_toggle ──
  if (action === 'task_toggle') {
    const { projectId, taskId } = req.body;
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const task = proj.tasks.find(t => t.id === taskId);
    if (task) { task.done = !task.done; task.finishedAt = task.done ? new Date() : null; }
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── add_task ──
  if (action === 'add_task') {
    const { projectId, text, priority } = req.body;
    if (!text?.trim()) { res.status(400).json({ error: 'Empty task' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    if (proj.tasks.length >= 1000) { res.status(429).json({ error: 'Task limit reached (1000 per project)' }); return; }
    const newId = 'task_' + uid();
    const safePriority = ['urgent', 'important', 'later'].includes(priority) ? priority : '';
    proj.tasks.push({ id: newId, text: text.trim().slice(0, 500), done: false, badge: 'Custom', notes: '', richNotes: '', files: [], deadline: '', assignee: '', assignees: [], priority: safePriority, comments: [] });
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true, id: newId });
    return;
  }

  // ── rename_task ──
  if (action === 'rename_task') {
    const { projectId, taskId, text } = req.body;
    if (!text?.trim()) { res.status(400).json({ error: 'Empty task' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const task = proj.tasks.find(t => t.id === taskId);
    if (task) task.text = text.trim().slice(0, 500);
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── update_task_meta ──
  if (action === 'update_task_meta') {
    const { projectId, taskId, deadline, assignee, assignees, priority, badge } = req.body;
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const task = proj.tasks.find(t => t.id === taskId);
    let prevAssignees = [];
    if (task) {
      prevAssignees = [...(task.assignees || [])];
      if (deadline  !== undefined) task.deadline  = deadline.trim();
      if (assignee  !== undefined) task.assignee  = assignee.trim();
      if (assignees !== undefined) task.assignees = Array.isArray(assignees) ? assignees : [];
      if (priority  !== undefined) task.priority  = priority.trim();
      if (badge     !== undefined) task.badge     = badge;
    }
    await proj.save();
    // Notify newly assigned users
    if (task && assignees !== undefined) {
      const prevSet = new Set(prevAssignees);
      const newlyAdded = (task.assignees || []).filter(a => !prevSet.has(a) && a !== 'me');
      if (newlyAdded.length) {
        const assigner = await User.findOne({ id: userId }).select('name username avatarUrl -_id');
        const notifDocs = [];
        for (const aid of newlyAdded) {
          const collab = proj.collaborators.find(c => c.id === aid);
          if (!collab?.userId || collab.userId === userId) continue;
          notifDocs.push({
            id: 'notif_' + uid(), toUserId: collab.userId, fromUserId: userId,
            fromUsername: assigner.username || '', fromName: assigner.name, fromAvatarUrl: assigner.avatarUrl || '',
            type: 'task_assigned',
            meta: { entityId: projectId, entityType: 'project', entityTitle: proj.title, taskId: task.id, taskTitle: task.text?.slice(0, 60) || '' },
            status: 'pending',
          });
        }
        if (notifDocs.length) await Notification.insertMany(notifDocs);
      }
    }
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── delete_task ──
  if (action === 'delete_task') {
    const { projectId, taskId } = req.body;
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const tIdx = proj.tasks.findIndex(t => t.id === taskId);
    if (tIdx > -1) {
      for (const f of proj.tasks[tIdx].files || []) await deleteStoredFile(f);
      proj.tasks.splice(tIdx, 1);
      await proj.save();
    }
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── restore_task ──
  if (action === 'restore_task') {
    const { projectId, task } = req.body;
    if (!task?.id || !task?.text) { res.status(400).json({ error: 'Invalid task' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const taskId_raw = String(task.id);
    const idCollision = proj.tasks.some(t => t.id === taskId_raw);
    // Only allow assignee IDs that actually exist on this project to prevent phantom notifications
    const validCollabIds = new Set(['me', ...proj.collaborators.map(c => c.id)]);
    const safeTask = {
      id: idCollision ? 'task_' + uid() : taskId_raw,
      text: String(task.text).trim().slice(0, 1000),
      done: Boolean(task.done),
      priority: ['urgent', 'important', 'later', ''].includes(task.priority) ? task.priority : '',
      deadline: task.deadline || '',
      badge: String(task.badge || 'Custom').slice(0, 50),
      assignees: Array.isArray(task.assignees) ? task.assignees.map(String).filter(a => validCollabIds.has(a)) : [],
      comments: [],
      notes: '', richNotes: '', files: [],
    };
    proj.tasks.push(safeTask);
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── save_notes ──
  if (action === 'save_notes') {
    const { projectId, notes = '' } = req.body;
    if (Buffer.byteLength(notes, 'utf8') > 200 * 1024) { res.status(413).json({ error: 'Notes too large (max 200KB)' }); return; }
    await Project.updateOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { notes } });
    res.json({ ok: true });
    return;
  }

  // ── save_project_rich_notes ──
  if (action === 'save_project_rich_notes') {
    const { projectId, notes = '' } = req.body;
    if (Buffer.byteLength(notes, 'utf8') > 200 * 1024) { res.status(413).json({ error: 'Notes too large (max 200KB)' }); return; }
    await Project.updateOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { richNotes: notes } });
    res.json({ ok: true });
    return;
  }

  // ── save_task_notes ──
  if (action === 'save_task_notes') {
    const { projectId, taskId, notes = '' } = req.body;
    if (Buffer.byteLength(notes, 'utf8') > 200 * 1024) { res.status(413).json({ error: 'Notes too large (max 200KB)' }); return; }
    await Project.updateOne({ id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { 'tasks.$.notes': notes } });
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── save_task_rich_notes ──
  if (action === 'save_task_rich_notes') {
    const { projectId, taskId, notes = '' } = req.body;
    if (Buffer.byteLength(notes, 'utf8') > 200 * 1024) { res.status(413).json({ error: 'Notes too large (max 200KB)' }); return; }
    await Project.updateOne({ id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { 'tasks.$.richNotes': notes } });
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── reorder_projects ──
  if (action === 'reorder_projects') {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length > 500) { res.status(400).json({ error: 'Invalid order' }); return; }
    const ops = order.map((id, index) => ({
      updateOne: { filter: { id, ownerId: userId }, update: { $set: { __orderRank: index } } }
    }));
    if (ops.length) await Project.collection.bulkWrite(ops);
    res.json({ ok: true });
    return;
  }

  // ── confirm_upload (R2 mode: browser finished uploading to R2, save metadata to DB) ──
  if (action === 'confirm_upload') {
    const { fileId, fileKey, filename, mimeType, size, type, projectId, taskId } = req.body;
    if (!fileId || !fileKey || !filename || !type) { return res.status(400).json({ error: 'Missing required fields' }); }
    const ext = path.extname(filename).toLowerCase().replace('.', '');
    const fe = { id: fileId, name: filename, file: fileKey, url: filePublicUrl(fileKey), type: ext, size: Number(size) || 0, uploaded: now() };

    if (type === 'avatar') {
      // The avatar always lives at the same key, so the URL must change on each
      // upload or browsers/CDN keep serving the previous cached image
      const avatarUrl = `${fe.url}?v=${Date.now()}`;
      await User.updateOne({ id: userId }, { avatarUrl });
      logger.info({ userId, fileKey }, '[upload] avatar confirmed');
      return res.json({ ok: true, avatarUrl });
    }
    if (type === 'task') {
      if (!projectId || !taskId) return res.status(400).json({ error: 'projectId and taskId required' });
      const result = await Project.updateOne(
        { id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] },
        { $push: { 'tasks.$.files': fe } },
      );
      if (result.matchedCount === 0) return res.status(403).json({ error: 'No access' });
      if (fe.size) await User.updateOne({ id: userId }, { $inc: { storageUsedBytes: fe.size } });
      logger.info({ userId, fileId, fileKey, projectId, taskId }, '[upload] task file confirmed');
      return res.json({ ok: true, file: fe });
    }
    // type === 'project'
    if (!projectId) return res.status(400).json({ error: 'projectId required' });
    const result = await Project.updateOne(
      { id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] },
      { $push: { files: fe } },
    );
    if (result.matchedCount === 0) return res.status(403).json({ error: 'No access' });
    if (fe.size) await User.updateOne({ id: userId }, { $inc: { storageUsedBytes: fe.size } });
    logger.info({ userId, fileId, fileKey, projectId }, '[upload] project file confirmed');
    return res.json({ ok: true, file: fe });
  }

  // ── upload (project-level, disk mode only) ──
  if (action === 'upload') {
    if (useR2) return res.status(400).json({ error: 'R2 mode: use get_upload_url + confirm_upload' });
    const pid = req.body.projectId;
    if (!pid || !req.file) { res.status(400).json({ error: !pid ? 'Missing projectId' : 'No file received' }); return; }
    const uploader = await User.findOne({ id: userId }).select('storageUsedBytes -_id').lean();
    if ((uploader?.storageUsedBytes || 0) + req.file.size > MAX_STORAGE_BYTES) {
      fs.unlinkSync(req.file.path);
      return res.status(413).json({ error: 'Storage quota exceeded (1 GB limit)' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const fe = { id: uid(), name: req.file.originalname, file: req.file.filename, url: filePublicUrl(req.file.filename), type: ext, size: req.file.size, uploaded: now() };
    const result = await Project.updateOne({ id: pid, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $push: { files: fe } });
    if (result.matchedCount === 0) { res.status(403).json({ error: 'Project not found or no editor access' }); return; }
    await User.updateOne({ id: userId }, { $inc: { storageUsedBytes: req.file.size } });
    res.json({ ok: true, file: fe });
    return;
  }

  // ── upload_task_file (disk mode only) ──
  if (action === 'upload_task_file') {
    if (useR2) return res.status(400).json({ error: 'R2 mode: use get_upload_url + confirm_upload' });
    const { projectId, taskId } = req.body;
    if (!projectId || !taskId || !req.file) { res.status(400).json({ error: !projectId ? 'Missing projectId' : !taskId ? 'Missing taskId' : 'No file received' }); return; }
    const uploader = await User.findOne({ id: userId }).select('storageUsedBytes -_id').lean();
    if ((uploader?.storageUsedBytes || 0) + req.file.size > MAX_STORAGE_BYTES) {
      fs.unlinkSync(req.file.path);
      return res.status(413).json({ error: 'Storage quota exceeded (1 GB limit)' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const fe = { id: uid(), name: req.file.originalname, file: req.file.filename, url: filePublicUrl(req.file.filename), type: ext, size: req.file.size, uploaded: now() };
    const result = await Project.updateOne({ id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $push: { 'tasks.$.files': fe } });
    if (result.matchedCount === 0) { res.status(403).json({ error: 'Project not found or no editor access' }); return; }
    await User.updateOne({ id: userId }, { $inc: { storageUsedBytes: req.file.size } });
    res.json({ ok: true, file: fe });
    return;
  }

  // ── delete_file (project-level) ──
  if (action === 'delete_file') {
    const { projectId, fileId } = req.body;
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const f = proj.files.find(x => x.id === fileId);
    if (f) {
      await deleteStoredFile(f);
      if (f.size) await User.updateOne({ id: proj.ownerId }, { $inc: { storageUsedBytes: -f.size } });
    }
    proj.files = proj.files.filter(x => x.id !== fileId);
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── delete_task_file ──
  if (action === 'delete_task_file') {
    const { projectId, taskId, fileId } = req.body;
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const task = proj.tasks.find(t => t.id === taskId);
    if (task) {
      const f = task.files.find(x => x.id === fileId);
      if (f) {
        await deleteStoredFile(f);
        if (f.size) await User.updateOne({ id: proj.ownerId }, { $inc: { storageUsedBytes: -f.size } });
      }
      task.files = task.files.filter(x => x.id !== fileId);
    }
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── add_space ──
  if (action === 'add_space') {
    const { title, icon = '📁', color = '#6366f1', description = '' } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: 'Title required' }); return; }
    if (!isValidColor(color)) { res.status(400).json({ error: 'Invalid color format' }); return; }
    const count = await Space.countDocuments({ ownerId: userId });
    if (count >= 50) { res.status(429).json({ error: 'Space limit reached (50 max)' }); return; }
    const newId = 'space_' + uid();
    await Space.create({ id: newId, title: title.trim().slice(0, 200), icon: safeIcon(icon), color, description: description.toString().slice(0, 500), ownerId: userId, __orderRank: count });
    res.json({ ok: true, id: newId });
    return;
  }

  // ── rename_space ──
  if (action === 'rename_space') {
    const { spaceId, title, icon, color, description } = req.body;
    if (!spaceId) { res.status(400).json({ error: 'Missing spaceId' }); return; }
    const update = {};
    if (title !== undefined) update.title = title.toString().trim().slice(0, 200);
    if (icon !== undefined) update.icon = safeIcon(icon);
    if (color !== undefined) {
      if (!isValidColor(color)) { res.status(400).json({ error: 'Invalid color format' }); return; }
      update.color = color;
    }
    if (description !== undefined) update.description = description.toString().slice(0, 500);
    await Space.updateOne({ id: spaceId, ownerId: userId }, { $set: update });
    res.json({ ok: true });
    return;
  }

  // ── delete_space ──
  if (action === 'delete_space') {
    const { spaceId } = req.body;
    if (!spaceId) { res.status(400).json({ error: 'Missing spaceId' }); return; }
    const spaceProjects = await Project.find({ spaceId, ownerId: userId }).lean();
    logger.info({ userId, spaceId, projectCount: spaceProjects.length }, '[audit] delete_space');
    for (const p of spaceProjects) {
      for (const f of p.files || []) await deleteStoredFile(f);
      for (const t of p.tasks || []) { for (const f of t.files || []) await deleteStoredFile(f); }
      await Project.deleteOne({ id: p.id, ownerId: userId });
    }
    await Space.deleteOne({ id: spaceId, ownerId: userId });
    res.json({ ok: true });
    return;
  }

  // ── invite_space_collaborator ──
  if (action === 'invite_space_collaborator') {
    const { spaceId, name = '', email, role = 'editor' } = req.body;
    if (!spaceId || !email?.trim()) { res.status(400).json({ error: 'Missing data' }); return; }
    if (!VALID_COLLAB_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const space = await Space.findOne({ id: spaceId, ownerId: userId });
    if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
    const exists = (space.collaborators || []).some(c => c.email?.toLowerCase() === email.toLowerCase());
    if (exists) { res.status(400).json({ error: 'Collaborator already exists' }); return; }
    space.collaborators.push({ id: crypto.randomUUID(), name: (name.trim() || email.replace(/@.*/, '')), email: email.trim(), role });
    await space.save();
    const inviter = await User.findOne({ id: userId }).select('name -_id');
    sendInviteEmail({ to: email.trim(), toName: name.trim(), inviterName: inviter?.name || 'Someone', spaceTitle: space.title });
    res.json({ ok: true });
    return;
  }

  // ── update_space_collaborator_role ──
  if (action === 'update_space_collaborator_role') {
    const { spaceId, collaboratorId, role } = req.body;
    if (!spaceId || !collaboratorId || !role) { res.status(400).json({ error: 'Missing data' }); return; }
    if (!VALID_COLLAB_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const space = await Space.findOne({ id: spaceId, ownerId: userId });
    if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
    const collab = space.collaborators.find(c => c.id === collaboratorId);
    if (!collab) { res.status(404).json({ error: 'Collaborator not found' }); return; }
    collab.role = role;
    await space.save();
    res.json({ ok: true });
    return;
  }

  // ── remove_space_collaborator ──
  if (action === 'remove_space_collaborator') {
    const { spaceId, collaboratorId } = req.body;
    if (!spaceId || !collaboratorId) { res.status(400).json({ error: 'Missing data' }); return; }
    const space = await Space.findOne({ id: spaceId, ownerId: userId });
    if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
    const removedCollab = space.collaborators.find(c => c.id === collaboratorId);
    space.collaborators = space.collaborators.filter(c => c.id !== collaboratorId);
    await space.save();
    // Evict from active LiveKit call for this space
    if (livekitEnabled && removedCollab?.userId) {
      const activeCall = await ActiveCall.findOne({ callId: spaceId }).lean();
      if (activeCall) await removeParticipant(activeCall.roomName, removedCollab.userId);
    }
    res.json({ ok: true });
    return;
  }

  // ── send_collab_invite ──
  if (action === 'send_collab_invite') {
    const { email, entityId, entityType, role } = req.body;
    if (!email || !entityId || !entityType || !role) { res.status(400).json({ error: 'Missing fields' }); return; }
    if (!['project', 'space'].includes(entityType)) { res.status(400).json({ error: 'Invalid entity type' }); return; }
    if (!VALID_COLLAB_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const cleanEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { res.status(400).json({ error: 'Invalid email address' }); return; }
    
    let entityTitle = '';
    let collaborators = [];
    let ownerId = '';
    
    if (entityType === 'project') {
      const proj = await Project.findOne({ id: entityId, ownerId: userId }).select('title collaborators ownerId -_id');
      if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
      entityTitle = proj.title;
      collaborators = proj.collaborators || [];
      ownerId = proj.ownerId;
    } else {
      const space = await Space.findOne({ id: entityId, ownerId: userId }).select('title collaborators ownerId -_id');
      if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
      entityTitle = space.title;
      collaborators = space.collaborators || [];
      ownerId = space.ownerId;
    }
    
    const target = await User.findOne({ email: cleanEmail }).select('id name username email avatarUrl -_id');
    const fromUser = await User.findOne({ id: userId }).select('name username avatarUrl -_id');
    
    if (target && target.id === userId) { res.status(400).json({ error: 'Cannot invite yourself' }); return; }
    if (target && collaborators.some(c => c.userId === target.id)) { res.status(409).json({ error: 'User is already a collaborator' }); return; }
    if (!target && collaborators.some(c => c.email.toLowerCase() === cleanEmail)) { res.status(409).json({ error: 'User is already invited' }); return; }
    
    // Generate unique Invite token
    const token = crypto.randomBytes(16).toString('hex');
    await Invite.create({
      token,
      email: cleanEmail,
      entityId,
      entityType,
      role,
      invitedBy: userId
    });
    
    const inviteUrl = `${APP_URL}?join=${token}`;
    
    // Send email using Resend
    if (resend) {
      try {
        await resend.emails.send({
          from: FROM_EMAIL,
          to: cleanEmail,
          subject: `${fromUser.name} invited you to collaborate on BrainJot`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#0a0a0a;color:#f5f5f5;border-radius:16px">
              <h1 style="font-size:28px;font-weight:800;margin:0 0 8px">🧠 BrainJot</h1>
              <p style="color:#888;font-size:14px;margin:0 0 32px">Your brain at a glance</p>

              <p style="font-size:16px;line-height:1.6;margin:0 0 24px">
                Hey,<br><br>
                <strong>${fromUser.name}</strong> has invited you to collaborate on the ${entityType} <strong>"${entityTitle}"</strong>.
              </p>

              <a href="${inviteUrl}" style="display:inline-block;background:#7C6FCD;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-weight:700;font-size:15px">
                Accept & Join Collaboration →
              </a>

              <p style="font-size:13px;color:#666;margin:32px 0 0;line-height:1.6">
                If you don't have a BrainJot account yet, clicking the link above will guide you to sign up. Once signed up, the collaboration will be automatically linked to your account.
              </p>
            </div>
          `,
        });
        logger.info({ to: cleanEmail }, '[email] collab invite email sent');
      } catch (err) {
        logger.error({ to: cleanEmail, error: err.message }, '[email] collab invite email failed');
      }
    } else {
      logger.warn('[email] RESEND_API_KEY not configured — skipping collaborator email');
    }
    
    if (target) {
      const alreadyPending = await Notification.findOne({ toUserId: target.id, fromUserId: userId, type: 'collab_invite', 'meta.entityId': entityId, status: 'pending' });
      if (!alreadyPending) {
        await Notification.create({
          id: 'notif_' + uid(), toUserId: target.id, fromUserId: userId,
          fromUsername: fromUser.username, fromName: fromUser.name, fromAvatarUrl: fromUser.avatarUrl || '',
          type: 'collab_invite',
          meta: { entityId, entityType, entityTitle, role, inviteToken: token },
          status: 'pending',
        });
      }
      res.json({ ok: true, invitedName: target.name });
    } else {
      res.json({ ok: true, notFound: true, invitedName: cleanEmail });
    }
    return;
  }

  // ── generate_invite_link ──
  if (action === 'generate_invite_link') {
    const { entityId, entityType, role = 'editor' } = req.body;
    if (!entityId || !entityType) { res.status(400).json({ error: 'Missing fields' }); return; }
    if (!['project', 'space'].includes(entityType)) { res.status(400).json({ error: 'Invalid entity type' }); return; }
    if (!VALID_COLLAB_ROLES.includes(role)) { res.status(400).json({ error: 'Invalid role' }); return; }
    const token = crypto.randomBytes(12).toString('hex');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    if (entityType === 'project') {
      await Project.updateOne({ id: entityId, ownerId: userId }, { $set: { inviteToken: token, inviteLinkRole: role, inviteTokenExpiry: expiry } });
    } else {
      await Space.updateOne({ id: entityId, ownerId: userId }, { $set: { inviteToken: token, inviteLinkRole: role, inviteTokenExpiry: expiry } });
    }
    res.json({ ok: true, token });
    return;
  }

  // ── join_via_link ──
  if (action === 'join_via_link') {
    const { token } = req.body;
    if (!token) { res.status(400).json({ error: 'Missing token' }); return; }
    
    let entity = await Project.findOne({ inviteToken: token }).lean();
    let entityType = entity ? 'project' : null;
    let isSpecificInvite = false;
    let specificInviteDoc = null;
    
    if (!entity) {
      entity = await Space.findOne({ inviteToken: token }).lean();
      entityType = entity ? 'space' : null;
    }
    
    if (!entity) {
      specificInviteDoc = await Invite.findOne({ token });
      if (specificInviteDoc) {
        isSpecificInvite = true;
        entityType = specificInviteDoc.entityType;
        if (entityType === 'project') {
          entity = await Project.findOne({ id: specificInviteDoc.entityId }).lean();
        } else {
          entity = await Space.findOne({ id: specificInviteDoc.entityId }).lean();
        }
      }
    }
    
    if (!entity) { res.status(404).json({ error: 'Invalid or expired invite link' }); return; }
    
    if (!isSpecificInvite && entity.inviteTokenExpiry && new Date(entity.inviteTokenExpiry) < new Date()) {
      res.status(410).json({ error: 'Invite link has expired' }); return;
    }
    
    if (entity.ownerId === userId) { res.json({ ok: true, alreadyOwner: true, entityType, entityId: entity.id, entityTitle: entity.title, role: 'owner' }); return; }
    
    if ((entity.collaborators || []).some(c => c.userId === userId)) { res.json({ ok: true, alreadyMember: true, entityType, entityId: entity.id, entityTitle: entity.title, role: (entity.collaborators.find(c => c.userId === userId))?.role || 'editor' }); return; }
    
    const me = await User.findOne({ id: userId }).select('id name username email avatarUrl -_id');
    
    if (isSpecificInvite && specificInviteDoc) {
      if (me.email.toLowerCase().trim() !== specificInviteDoc.email.toLowerCase().trim()) {
        res.status(403).json({ error: `This invite is for ${specificInviteDoc.email}, but you are signed in as ${me.email}.` });
        return;
      }
    }
    
    const role = isSpecificInvite ? specificInviteDoc.role : (entity.inviteLinkRole || 'editor');
    const collabEntry = { id: 'c_' + uid(), userId: me.id, name: me.name, username: me.username || '', email: me.email || '', role, avatarUrl: me.avatarUrl || '' };
    
    if (entityType === 'project') {
      if (isSpecificInvite) {
        await Project.updateOne({ id: entity.id }, { $push: { collaborators: collabEntry } });
      } else {
        // Atomic update: the inviteToken filter ensures only one concurrent request wins.
        // If the token was already cleared by a race partner, findOneAndUpdate returns null.
        const atomicResult = await Project.findOneAndUpdate(
          { id: entity.id, inviteToken: token },
          { $push: { collaborators: collabEntry }, $unset: { inviteToken: '', inviteTokenExpiry: '' } }
        );
        if (!atomicResult) {
          return res.status(410).json({ error: 'This invite link was just used. Ask the owner to generate a new one.' });
        }
      }
    } else {
      if (isSpecificInvite) {
        await Space.updateOne({ id: entity.id }, { $push: { collaborators: collabEntry } });
      } else {
        const atomicResult = await Space.findOneAndUpdate(
          { id: entity.id, inviteToken: token },
          { $push: { collaborators: collabEntry }, $unset: { inviteToken: '', inviteTokenExpiry: '' } }
        );
        if (!atomicResult) {
          return res.status(410).json({ error: 'This invite link was just used. Ask the owner to generate a new one.' });
        }
      }
    }
    
    if (isSpecificInvite) {
      await Invite.deleteOne({ _id: specificInviteDoc._id });
      // Mark matching pending collab invites as accepted
      await Notification.updateMany(
        { toUserId: userId, type: 'collab_invite', 'meta.entityId': entity.id, status: 'pending' },
        { status: 'accepted' }
      );
    }
    
    await Notification.create({
      id: 'notif_' + uid(), toUserId: entity.ownerId, fromUserId: userId,
      fromUsername: me.username || '', fromName: me.name, fromAvatarUrl: me.avatarUrl || '',
      type: 'invite_response',
      meta: { entityId: entity.id, entityType, entityTitle: entity.title, role, accepted: true },
      status: 'pending',
    });
    
    res.json({ ok: true, entityType, entityId: entity.id, entityTitle: entity.title, role });
    return;
  }
  
  // ── respond_collab_invite ──
  if (action === 'respond_collab_invite') {
    const { notifId, accept } = req.body;
    const notif = await Notification.findOne({ id: notifId, toUserId: userId, type: 'collab_invite', status: 'pending' });
    if (!notif) { res.status(404).json({ error: 'Invite not found or already handled' }); return; }
    notif.status = accept ? 'accepted' : 'denied';
    await notif.save();
    
    const me = await User.findOne({ id: userId }).select('id name username email avatarUrl -_id');
    
    if (accept) {
      const collabEntry = { id: 'c_' + uid(), userId: me.id, name: me.name, username: me.username || '', email: me.email || '', role: notif.meta.role, avatarUrl: me.avatarUrl || '' };
      if (notif.meta.entityType === 'project') {
        await Project.updateOne({ id: notif.meta.entityId }, { $push: { collaborators: collabEntry } });
      } else {
        await Space.updateOne({ id: notif.meta.entityId }, { $push: { collaborators: collabEntry } });
      }
    }
    
    // Clean up specific invite in database
    if (notif.meta && notif.meta.inviteToken) {
      await Invite.deleteOne({ token: notif.meta.inviteToken });
    }
    
    // Notify the inviter of the response (accept or deny)
    if (notif.fromUserId) {
      await Notification.create({
        id: 'notif_' + uid(), toUserId: notif.fromUserId, fromUserId: userId,
        fromUsername: me.username || '', fromName: me.name, fromAvatarUrl: me.avatarUrl || '',
        type: 'invite_response',
        meta: { entityId: notif.meta.entityId, entityType: notif.meta.entityType, entityTitle: notif.meta.entityTitle, role: notif.meta.role, accepted: accept },
        status: 'pending',
      });
    }
    res.json({ ok: true, accepted: accept });
    return;
  }

  // ── mark_notification_read ──
  if (action === 'mark_notification_read') {
    const { notifId } = req.body || {};
    if (notifId) {
      await Notification.updateOne({ id: notifId, toUserId: userId }, { status: 'read' });
    } else {
      // Mark all read except pending collab invites (user still needs to respond to those)
      await Notification.updateMany(
        { toUserId: userId, $or: [{ type: { $ne: 'collab_invite' } }, { status: { $ne: 'pending' } }] },
        { status: 'read' }
      );
    }
    res.json({ ok: true });
    return;
  }

  // ── set_username ──
  if (action === 'set_username') {
    const { username } = req.body;
    const me = await User.findOne({ id: userId });
    if (!me) { res.status(404).json({ error: 'User not found' }); return; }
    if (me.username) { res.status(409).json({ error: 'Username already set and cannot be changed' }); return; }
    const raw = (username || '').toLowerCase().trim();
    if (!raw || raw.length < 3) { res.status(400).json({ error: 'Username must be at least 3 characters' }); return; }
    if (raw.length > 20) { res.status(400).json({ error: 'Username must be 20 characters or less' }); return; }
    if (!/^[a-z0-9_]+$/.test(raw)) { res.status(400).json({ error: 'Only letters, numbers and _ allowed' }); return; }
    const exists = await User.findOne({ username: raw });
    if (exists) { res.status(409).json({ error: 'Username already taken' }); return; }
    me.username = raw;
    await me.save();
    res.json({ ok: true, username: raw });
    return;
  }

  // ── add_task_comment ──
  if (action === 'add_task_comment') {
    const { projectId, taskId, text, mentions = [] } = req.body;
    if (!projectId || !taskId || !text?.trim()) { res.status(400).json({ error: 'Missing data' }); return; }
    const safeMentions = Array.isArray(mentions) ? mentions.slice(0, 20).map(String) : [];
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { 'collaborators.userId': userId }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const taskForCap = proj.tasks.find(t => t.id === taskId);
    if (!taskForCap) { res.status(404).json({ error: 'Task not found' }); return; }
    if ((taskForCap.comments || []).length >= 500) { res.status(429).json({ error: 'Comment limit reached (500 per task)' }); return; }
    const me = await User.findOne({ id: userId }).select('name username avatarUrl -_id');
    const comment = { id: 'cmt_' + uid(), userId, username: me.username || '', name: me.name, avatarUrl: me.avatarUrl || '', text: text.trim().slice(0, 1000), mentions: safeMentions, createdAt: new Date() };
    await Project.updateOne({ id: projectId, 'tasks.id': taskId }, { $push: { 'tasks.$.comments': comment } });
    const task = taskForCap;
    const notifBase = { fromUserId: userId, fromUsername: me.username || '', fromName: me.name, fromAvatarUrl: me.avatarUrl || '', status: 'pending' };
    const allNotifs = [];
    // Build set of project member IDs so @mentions only notify actual members
    const projectMemberIds = new Set([proj.ownerId, ...(proj.collaborators || []).map(c => c.userId).filter(Boolean)]);
    // @mention notifications (only for project members)
    let mentionedUserIds = new Set();
    if (safeMentions.length) {
      const mentionedUsers = await User.find({ username: { $in: safeMentions } }).select('id -_id').lean();
      mentionedUsers.filter(u => u.id !== userId && projectMemberIds.has(u.id)).forEach(u => {
        mentionedUserIds.add(u.id);
        allNotifs.push({ id: 'notif_' + uid(), ...notifBase, toUserId: u.id, type: 'mention',
          meta: { entityId: projectId, entityType: 'project', entityTitle: proj.title, taskId, taskTitle: task?.text?.slice(0, 60) || '', commentText: text.trim().slice(0, 100) } });
      });
    }
    // task_comment notifications for assignees not already @mentioned
    for (const aid of (task?.assignees || [])) {
      let toUserId;
      if (aid === 'me') { toUserId = proj.ownerId; }
      else { toUserId = proj.collaborators.find(c => c.id === aid)?.userId; }
      if (!toUserId || toUserId === userId || mentionedUserIds.has(toUserId)) continue;
      allNotifs.push({ id: 'notif_' + uid(), ...notifBase, toUserId, type: 'task_comment',
        meta: { entityId: projectId, entityType: 'project', entityTitle: proj.title, taskId, taskTitle: task?.text?.slice(0, 60) || '', commentText: text.trim().slice(0, 100) } });
    }
    if (allNotifs.length) {
      // Rate-limit outgoing notifications: a single user can send at most 100 per hour.
      // This prevents a malicious collaborator from flooding targets via @mentions.
      const recentOutgoing = await Notification.countDocuments({
        fromUserId: userId,
        createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
      });
      if (recentOutgoing + allNotifs.length <= 100) {
        await Notification.insertMany(allNotifs);
      } else {
        logger.warn({ userId, recentOutgoing, attempted: allNotifs.length }, '[rate_limit] notification outgoing limit reached');
      }
    }
    emitProjectUpdate(req, projectId);
    res.json({ ok: true, comment });
    return;
  }

  // ── add_project_label ──
  if (action === 'add_project_label') {
    const { projectId, name, color } = req.body;
    if (!name?.trim()) { res.status(400).json({ error: 'Label name required' }); return; }
    if (color !== undefined && !isValidColor(color)) { res.status(400).json({ error: 'Invalid color format' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const labelId = 'lbl_' + uid();
    proj.labels.push({ id: labelId, name: name.trim().slice(0, 30), color: isValidColor(color) ? color : '#6366f1' });
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true, id: labelId });
    return;
  }

  // ── update_project_label ──
  if (action === 'update_project_label') {
    const { projectId, labelId, name, color } = req.body;
    if (!labelId) { res.status(400).json({ error: 'labelId required' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const label = proj.labels.find(l => l.id === labelId);
    if (!label) { res.status(404).json({ error: 'Label not found' }); return; }
    if (name?.trim()) label.name = name.trim().slice(0, 30);
    if (color && isValidColor(color)) label.color = color;
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── delete_project_label ──
  if (action === 'delete_project_label') {
    const { projectId, labelId } = req.body;
    if (!labelId) { res.status(400).json({ error: 'labelId required' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    proj.labels = proj.labels.filter(l => l.id !== labelId);
    proj.tasks.forEach(t => { if (t.badge === labelId) t.badge = ''; });
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── reorder_spaces ──
  if (action === 'reorder_spaces') {
    const { order } = req.body;
    if (!Array.isArray(order) || order.length > 500) { res.status(400).json({ error: 'Invalid order' }); return; }
    const ops = order.map((id, index) => ({
      updateOne: { filter: { id, ownerId: userId }, update: { $set: { __orderRank: index } } }
    }));
    if (ops.length) await Space.collection.bulkWrite(ops);
    res.json({ ok: true });
    return;
  }

  res.status(404).json({ error: 'Unknown action' });
});

module.exports = { router, seedDefaultData };
