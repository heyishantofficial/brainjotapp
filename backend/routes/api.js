const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const { Resend } = require('resend');
const Project = require('../models/Project');
const Space = require('../models/Space');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const Notification = require('../models/Notification');

const router = express.Router();

function emitProjectUpdate(req, projectId) {
  req.app.get('io')?.to(`project:${projectId}`).emit('project_updated', { projectId });
}

const APP_URL = process.env.APP_URL || 'https://brainjotapp.up.railway.app';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const FROM_EMAIL = process.env.FROM_EMAIL || 'BrainJot <onboarding@resend.dev>';
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function sendInviteEmail({ to, toName, inviterName, projectTitle, spaceTitle }) {
  if (!resend) return;
  const subjectTarget = projectTitle ? `project "${projectTitle}"` : `space "${spaceTitle}"`;
  const displayTarget = projectTitle || spaceTitle;
  try {
    await resend.emails.send({
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
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
}

const UPLOADS_DIR = path.resolve(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');
const SALT_ROUNDS = 12;

// ── R2 / S3 storage setup ─────────────────────────────────────────
const useR2 = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);

const s3 = useR2 ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

async function deleteStoredFile(fileRecord) {
  if (useR2) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: fileRecord.file }));
    } catch (_) { /* ignore missing files */ }
  } else {
    const fp = path.join(UPLOADS_DIR, fileRecord.file);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  }
}

function filePublicUrl(key) {
  return useR2
    ? `${process.env.R2_PUBLIC_URL}/${key}`
    : `uploads/${key}`;
}

// ── Multer setup ──────────────────────────────────────────────────
const ALLOWED_EXT = new Set([
  'jpg','jpeg','png','gif','webp','pdf',
  'doc','docx','xls','xlsx','ppt','pptx',
  'mp4','mov','zip','txt','csv',
]);

function makeKey(req, file) {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const tid = req.body.taskId;
  const pid = req.body.projectId;
  const prefix = tid ? `task_${tid}_` : `${pid}_`;
  return `${prefix}${crypto.randomUUID()}.${ext}`;
}

const storage = useR2
  ? multerS3({
      s3,
      bucket: process.env.R2_BUCKET_NAME,
      key: (req, file, cb) => cb(null, makeKey(req, file)),
    })
  : multer.diskStorage({
      destination(_req, _file, cb) {
        if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
      },
      filename: (req, file, cb) => cb(null, makeKey(req, file)),
    });

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  },
});

const avatarStorage = useR2
  ? multerS3({
      s3,
      bucket: process.env.R2_BUCKET_NAME,
      key: (req, _file, cb) => cb(null, `avatars/${req.session.userId}.jpg`),
    })
  : multer.diskStorage({
      destination(_req, _file, cb) {
        const dir = path.join(UPLOADS_DIR, 'avatars');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, _file, cb) => cb(null, `${req.session.userId}.jpg`),
    });
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 2 * 1024 * 1024 } });

function conditionalUpload(req, res, next) {
  const action = req.query.action;
  if (action === 'upload' || action === 'upload_task_file') {
    upload.single('file')(req, res, next);
  } else if (action === 'upload_avatar') {
    uploadAvatar.single('file')(req, res, next);
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

// ── Rate limiters ─────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Download helper ───────────────────────────────────────────────
router.get('/download', requireAuth, (req, res) => {
  const fileUrl = req.query.url;
  const originalName = req.query.name;

  if (!fileUrl) return res.status(400).send('File URL is required');

  // R2 files have a full HTTPS public URL — redirect directly
  if (fileUrl.startsWith('https://')) {
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
router.get('/', async (req, res) => {
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
    if (req.session.userId) {
      const user = await User.findOne({ id: req.session.userId }).select('name email username role avatarUrl -_id');
      if (user) req.session.userRole = user.role || 'user';
      res.json({ loggedIn: true, user: user ? { id: req.session.userId, name: user.name, email: user.email, username: user.username || '', role: user.role || 'user', avatarUrl: user.avatarUrl || '' } : null });
    } else {
      res.json({ loggedIn: false });
    }
    return;
  }

  if (!req.session.userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const userId = req.session.userId;

  if (action === 'find_user') {
    const q = (req.query.q || '').replace(/^@/, '').toLowerCase().trim();
    if (q.length < 2) { res.json({ users: [] }); return; }
    const safeQ = q.replace(/[^a-z0-9_]/g, '');
    const users = await User.find({ username: { $regex: '^' + safeQ }, id: { $ne: userId } })
      .select('id name username avatarUrl -_id').limit(8).lean();
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
    const spaces   = await Space.find({ ownerId: userId }).sort({ __orderRank: 1 }).select('-_id -__v');
    const projects = await Project.find({ ownerId: userId }).sort({ __orderRank: 1 }).select('-_id -__v');
    const sharedProjectDocs = await Project.find({ 'collaborators.userId': userId, ownerId: { $ne: userId } }).select('-_id -__v').lean();
    const sharedSpaceDocs   = await Space.find({ 'collaborators.userId': userId, ownerId: { $ne: userId } }).select('-_id -__v').lean();
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
      projects: toPlain(projects),
      sharedProjects: annotateShared(sharedProjectDocs),
      sharedSpaces: annotateShared(sharedSpaceDocs),
    });
    return;
  }

  if (action === 'get_feedback') {
    const raw = await Feedback.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      items: raw.map(({ _id, __v, upvotes, ...rest }) => ({
        ...rest,
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

  res.status(404).json({ error: 'Unknown action' });
});

// ── POST routes ───────────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  const action = req.query.action;

  // ── register ──
  if (action === 'register') {
    return authLimiter(req, res, async () => {
      try {
        const { email, password, name, username } = req.body;
        if (!email?.trim() || !password || !name?.trim()) {
          return res.status(400).json({ error: 'Name, email and password are required' });
        }
        if (password.length < 8) {
          return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (!username?.trim()) {
          return res.status(400).json({ error: 'Username is required' });
        }
        const cleanUsername = username.toLowerCase().trim();
        if (cleanUsername.length < 3 || cleanUsername.length > 20 || !/^[a-z0-9_]+$/.test(cleanUsername)) {
          return res.status(400).json({ error: 'Username must be 3-20 chars, letters/numbers/underscores only' });
        }
        const existing = await User.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
          return res.status(409).json({ error: 'An account with this email already exists' });
        }
        const takenUsername = await User.findOne({ username: cleanUsername });
        if (takenUsername) {
          return res.status(409).json({ error: 'Username already taken' });
        }
        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
        const userId = 'user_' + uid();
        const role = ADMIN_EMAILS.includes(email.toLowerCase().trim()) ? 'superadmin' : 'user';
        const user = await User.create({ id: userId, email: email.toLowerCase().trim(), name: name.trim(), username: cleanUsername, passwordHash, role });
        await seedDefaultData(userId);
        req.session.userId = userId;
        req.session.userRole = role;
        res.json({ ok: true, user: { id: userId, name: user.name, email: user.email, username: user.username, role, avatarUrl: '' } });
      } catch (err) {
        next(err);
      }
    });
  }

  // ── login ──
  if (action === 'login') {
    return authLimiter(req, res, async () => {
      try {
        const { email, password } = req.body;
        if (!email?.trim() || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
        }
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const match = await bcrypt.compare(password, user.passwordHash);
        if (!match) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        // Auto-elevate if email is in ADMIN_EMAILS
        if (ADMIN_EMAILS.includes(user.email) && user.role !== 'superadmin') {
          await User.updateOne({ id: user.id }, { role: 'superadmin' });
          user.role = 'superadmin';
        }
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
    const { name, email } = req.body;
    const updates = {};
    if (name?.trim()) updates.name = name.trim();
    if (email?.trim()) {
      const taken = await User.findOne({ email: email.toLowerCase().trim(), id: { $ne: userId } });
      if (taken) { res.status(409).json({ error: 'Email already in use' }); return; }
      updates.email = email.toLowerCase().trim();
    }
    if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nothing to update' }); return; }
    await User.updateOne({ id: userId }, updates);
    res.json({ ok: true, name: updates.name, email: updates.email });
    return;
  }

  // ── upload_avatar ──
  if (action === 'upload_avatar') {
    if (!req.file) { res.status(400).json({ error: 'No file received' }); return; }
    const key = `avatars/${userId}.jpg`;
    const avatarUrl = filePublicUrl(key);
    await User.updateOne({ id: userId }, { avatarUrl });
    res.json({ ok: true, avatarUrl });
    return;
  }

  // ── change_password ──
  if (action === 'change_password') {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Both passwords required' }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: 'New password must be at least 8 characters' }); return; }
    const user = await User.findOne({ id: userId });
    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) { res.status(401).json({ error: 'Current password is incorrect' }); return; }
    await User.updateOne({ id: userId }, { passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS) });
    res.json({ ok: true });
    return;
  }

  // ── delete_account ──
  if (action === 'delete_account') {
    const { password } = req.body;
    if (!password) { res.status(400).json({ error: 'Password required' }); return; }
    const user = await User.findOne({ id: userId });
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) { res.status(401).json({ error: 'Incorrect password' }); return; }
    await Promise.all([
      User.deleteOne({ id: userId }),
      Project.deleteMany({ ownerId: userId }),
      Space.deleteMany({ ownerId: userId }),
      Feedback.deleteMany({ userId }),
    ]);
    req.session.destroy(() => res.json({ ok: true }));
    return;
  }

  // ── export_data ──
  if (action === 'export_data') {
    const [projects, spaces] = await Promise.all([
      Project.find({ ownerId: userId }).select('-_id -__v').lean(),
      Space.find({ ownerId: userId }).select('-_id -__v').lean(),
    ]);
    res.json({ spaces, projects, exportedAt: new Date().toISOString() });
    return;
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
    const item = await Feedback.findOne({ id: feedbackId });
    if (!item) { res.status(404).json({ error: 'Not found' }); return; }
    const idx = item.upvotes.indexOf(userId);
    if (idx === -1) item.upvotes.push(userId);
    else item.upvotes.splice(idx, 1);
    await item.save();
    res.json({ ok: true, upvoteCount: item.upvotes.length, hasUpvoted: idx === -1 });
    return;
  }

  // ── add_project ──
  if (action === 'add_project') {
    const { title, subtitle = '', color = '#888785', tag = 'Project', spaceId = '' } = req.body;
    if (!title?.trim()) { res.status(400).json({ error: 'Title required' }); return; }
    const newId = 'proj_' + uid();
    const count = await Project.countDocuments({ spaceId, ownerId: userId });
    await Project.create({ id: newId, title: title.trim(), subtitle, color, tag, spaceId, ownerId: userId, tasks: [], notes: '', richNotes: '', files: [], collaborators: [], __orderRank: count });
    res.json({ ok: true, id: newId });
    return;
  }

  // ── rename_project ──
  if (action === 'rename_project') {
    const { projectId, title, subtitle, tag, color } = req.body;
    if (!projectId || !title?.trim()) { res.status(400).json({ error: 'Missing data' }); return; }
    const update = { title: title.trim() };
    if (subtitle !== undefined) update.subtitle = subtitle.trim();
    if (tag !== undefined) update.tag = tag.trim() || 'Project';
    if (color !== undefined) update.color = color;
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: update });
    res.json({ ok: true });
    return;
  }

  // ── duplicate_project ──
  if (action === 'duplicate_project') {
    const { projectId } = req.body;
    const source = await Project.findOne({ id: projectId, ownerId: userId }).lean();
    if (!source) { res.status(404).json({ error: 'Project not found' }); return; }
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
    for (const t of proj.tasks || []) { for (const f of t.files || []) await deleteStoredFile(f); }
    proj.tasks = [];
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── invite_collaborator ──
  if (action === 'invite_collaborator') {
    const { projectId, name = '', email } = req.body;
    if (!projectId || !email?.trim()) { res.status(400).json({ error: 'Missing data' }); return; }
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const exists = proj.collaborators.some(c => c.email.toLowerCase() === email.toLowerCase());
    if (exists) { res.status(400).json({ error: 'Collaborator already exists' }); return; }
    const collab = { id: 'collab_' + uid(), name: name.trim() || email.replace(/@.*/, ''), email: email.trim(), status: 'invited' };
    proj.collaborators.push(collab);
    await proj.save();
    const inviter = await User.findOne({ id: userId }).select('name -_id');
    sendInviteEmail({ to: email.trim(), toName: name.trim(), inviterName: inviter?.name || 'Someone', projectTitle: proj.title });
    res.json({ ok: true, collaborator: collab });
    return;
  }

  // ── remove_collaborator ──
  if (action === 'remove_collaborator') {
    const { projectId, collaboratorId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    proj.collaborators = proj.collaborators.filter(c => c.id !== collaboratorId);
    proj.tasks.forEach(t => {
      if (t.assignee === collaboratorId) t.assignee = '';
      if (Array.isArray(t.assignees)) t.assignees = t.assignees.filter(a => a !== collaboratorId);
    });
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
    const { projectId, text } = req.body;
    if (!text?.trim()) { res.status(400).json({ error: 'Empty task' }); return; }
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const newId = 'task_' + uid();
    proj.tasks.push({ id: newId, text: text.trim(), done: false, badge: 'Custom', notes: '', richNotes: '', files: [], deadline: '', assignee: '', assignees: [], priority: '', comments: [] });
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
    if (task) task.text = text.trim();
    await proj.save();
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── update_task_meta ──
  if (action === 'update_task_meta') {
    const { projectId, taskId, deadline, assignee, assignees, priority, comments } = req.body;
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
      if (comments  !== undefined) task.comments  = Array.isArray(comments) ? comments : [];
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
    const safeTask = {
      id: String(task.id),
      text: String(task.text).trim().slice(0, 1000),
      done: Boolean(task.done),
      priority: ['urgent', 'important', 'later', ''].includes(task.priority) ? task.priority : '',
      deadline: task.deadline || '',
      badge: String(task.badge || 'Custom').slice(0, 50),
      assignees: Array.isArray(task.assignees) ? task.assignees.map(String) : [],
      comments: Array.isArray(task.comments) ? task.comments : [],
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
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: { notes } });
    res.json({ ok: true });
    return;
  }

  // ── save_project_rich_notes ──
  if (action === 'save_project_rich_notes') {
    const { projectId, notes = '' } = req.body;
    await Project.updateOne({ id: projectId, ownerId: userId }, { $set: { richNotes: notes } });
    res.json({ ok: true });
    return;
  }

  // ── save_task_notes ──
  if (action === 'save_task_notes') {
    const { projectId, taskId, notes = '' } = req.body;
    await Project.updateOne({ id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { 'tasks.$.notes': notes } });
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── save_task_rich_notes ──
  if (action === 'save_task_rich_notes') {
    const { projectId, taskId, notes = '' } = req.body;
    await Project.updateOne({ id: projectId, 'tasks.id': taskId, $or: [{ ownerId: userId }, { collaborators: { $elemMatch: { userId, role: 'editor' } } }] }, { $set: { 'tasks.$.richNotes': notes } });
    emitProjectUpdate(req, projectId);
    res.json({ ok: true });
    return;
  }

  // ── reorder_projects ──
  if (action === 'reorder_projects') {
    const { order } = req.body;
    if (!Array.isArray(order)) { res.status(400).json({ error: 'Invalid order' }); return; }
    const ops = order.map((id, index) => ({
      updateOne: { filter: { id, ownerId: userId }, update: { $set: { __orderRank: index } } }
    }));
    if (ops.length) await Project.collection.bulkWrite(ops);
    res.json({ ok: true });
    return;
  }

  // ── upload (project-level) ──
  if (action === 'upload') {
    const pid = req.body.projectId;
    if (!pid || !req.file) { res.status(400).json({ error: 'Missing data' }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const key = useR2 ? req.file.key : req.file.filename;
    const fe = { id: uid(), name: req.file.originalname, file: key, url: filePublicUrl(key), type: ext, size: req.file.size, uploaded: now() };
    await Project.updateOne({ id: pid, ownerId: userId }, { $push: { files: fe } });
    res.json({ ok: true, file: fe });
    return;
  }

  // ── upload_task_file ──
  if (action === 'upload_task_file') {
    const { projectId, taskId } = req.body;
    if (!projectId || !taskId || !req.file) { res.status(400).json({ error: 'Missing data' }); return; }
    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const key = useR2 ? req.file.key : req.file.filename;
    const fe = { id: uid(), name: req.file.originalname, file: key, url: filePublicUrl(key), type: ext, size: req.file.size, uploaded: now() };
    await Project.updateOne({ id: projectId, ownerId: userId, 'tasks.id': taskId }, { $push: { 'tasks.$.files': fe } });
    res.json({ ok: true, file: fe });
    return;
  }

  // ── delete_file (project-level) ──
  if (action === 'delete_file') {
    const { projectId, fileId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const f = proj.files.find(x => x.id === fileId);
    if (f) await deleteStoredFile(f);
    proj.files = proj.files.filter(x => x.id !== fileId);
    await proj.save();
    res.json({ ok: true });
    return;
  }

  // ── delete_task_file ──
  if (action === 'delete_task_file') {
    const { projectId, taskId, fileId } = req.body;
    const proj = await Project.findOne({ id: projectId, ownerId: userId });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const task = proj.tasks.find(t => t.id === taskId);
    if (task) {
      const f = task.files.find(x => x.id === fileId);
      if (f) await deleteStoredFile(f);
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
    const count = await Space.countDocuments({ ownerId: userId });
    const newId = 'space_' + uid();
    await Space.create({ id: newId, title: title.trim(), icon, color, description, ownerId: userId, __orderRank: count });
    res.json({ ok: true, id: newId });
    return;
  }

  // ── rename_space ──
  if (action === 'rename_space') {
    const { spaceId, title, icon, color, description } = req.body;
    if (!spaceId) { res.status(400).json({ error: 'Missing spaceId' }); return; }
    const update = {};
    if (title !== undefined) update.title = title.trim();
    if (icon !== undefined) update.icon = icon;
    if (color !== undefined) update.color = color;
    if (description !== undefined) update.description = description;
    await Space.updateOne({ id: spaceId, ownerId: userId }, { $set: update });
    res.json({ ok: true });
    return;
  }

  // ── delete_space ──
  if (action === 'delete_space') {
    const { spaceId } = req.body;
    if (!spaceId) { res.status(400).json({ error: 'Missing spaceId' }); return; }
    const spaceProjects = await Project.find({ spaceId, ownerId: userId }).lean();
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
    space.collaborators = space.collaborators.filter(c => c.id !== collaboratorId);
    await space.save();
    res.json({ ok: true });
    return;
  }

  // ── send_collab_invite ──
  if (action === 'send_collab_invite') {
    const { email, entityId, entityType, role } = req.body;
    if (!email || !entityId || !entityType || !role) { res.status(400).json({ error: 'Missing fields' }); return; }
    const cleanEmail = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) { res.status(400).json({ error: 'Invalid email address' }); return; }
    let entityTitle = '';
    if (entityType === 'project') {
      const proj = await Project.findOne({ id: entityId, ownerId: userId }).select('title collaborators -_id');
      if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
      entityTitle = proj.title;
      const target = await User.findOne({ email: cleanEmail }).select('id -_id');
      if (target && proj.collaborators.some(c => c.userId === target.id)) { res.status(409).json({ error: 'User is already a collaborator' }); return; }
    } else {
      const space = await Space.findOne({ id: entityId, ownerId: userId }).select('title collaborators -_id');
      if (!space) { res.status(404).json({ error: 'Space not found' }); return; }
      entityTitle = space.title;
      const target = await User.findOne({ email: cleanEmail }).select('id -_id');
      if (target && space.collaborators.some(c => c.userId === target.id)) { res.status(409).json({ error: 'User is already a collaborator' }); return; }
    }
    const target = await User.findOne({ email: cleanEmail }).select('id name username email avatarUrl -_id');
    const fromUser = await User.findOne({ id: userId }).select('name username avatarUrl -_id');
    if (!target) {
      sendInviteEmail({ to: cleanEmail, toName: '', inviterName: fromUser.name, projectTitle: entityType === 'project' ? entityTitle : null, spaceTitle: entityType === 'space' ? entityTitle : null });
      res.json({ ok: true, notFound: true, invitedName: cleanEmail });
      return;
    }
    if (target.id === userId) { res.status(400).json({ error: 'Cannot invite yourself' }); return; }
    const alreadyPending = await Notification.findOne({ toUserId: target.id, fromUserId: userId, type: 'collab_invite', 'meta.entityId': entityId, status: 'pending' });
    if (alreadyPending) { res.status(409).json({ error: 'Invite already pending for this user' }); return; }
    await Notification.create({
      id: 'notif_' + uid(), toUserId: target.id, fromUserId: userId,
      fromUsername: fromUser.username, fromName: fromUser.name, fromAvatarUrl: fromUser.avatarUrl || '',
      type: 'collab_invite',
      meta: { entityId, entityType, entityTitle, role },
      status: 'pending',
    });
    res.json({ ok: true, invitedName: target.name });
    return;
  }

  // ── generate_invite_link ──
  if (action === 'generate_invite_link') {
    const { entityId, entityType, role = 'editor' } = req.body;
    if (!entityId || !entityType) { res.status(400).json({ error: 'Missing fields' }); return; }
    const token = crypto.randomBytes(12).toString('hex');
    if (entityType === 'project') {
      await Project.updateOne({ id: entityId, ownerId: userId }, { $set: { inviteToken: token, inviteLinkRole: role } });
    } else {
      await Space.updateOne({ id: entityId, ownerId: userId }, { $set: { inviteToken: token, inviteLinkRole: role } });
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
    if (!entity) {
      entity = await Space.findOne({ inviteToken: token }).lean();
      entityType = entity ? 'space' : null;
    }
    if (!entity) { res.status(404).json({ error: 'Invalid or expired invite link' }); return; }
    if (entity.ownerId === userId) { res.json({ ok: true, alreadyOwner: true, entityType, entityId: entity.id, entityTitle: entity.title, role: 'owner' }); return; }
    if ((entity.collaborators || []).some(c => c.userId === userId)) { res.json({ ok: true, alreadyMember: true, entityType, entityId: entity.id, entityTitle: entity.title, role: (entity.collaborators.find(c => c.userId === userId))?.role || 'editor' }); return; }
    const me = await User.findOne({ id: userId }).select('id name username email avatarUrl -_id');
    const role = entity.inviteLinkRole || 'editor';
    const collabEntry = { id: 'c_' + uid(), userId: me.id, name: me.name, username: me.username || '', email: me.email || '', role, avatarUrl: me.avatarUrl || '' };
    if (entityType === 'project') {
      await Project.updateOne({ id: entity.id }, { $push: { collaborators: collabEntry } });
    } else {
      await Space.updateOne({ id: entity.id }, { $push: { collaborators: collabEntry } });
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
      await Notification.updateOne({ id: notifId, toUserId: userId, status: { $nin: ['pending'] } }, { status: 'read' });
    } else {
      await Notification.updateMany({ toUserId: userId, status: { $nin: ['pending', 'accepted', 'denied'] } }, { status: 'read' });
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
    const proj = await Project.findOne({ id: projectId, $or: [{ ownerId: userId }, { 'collaborators.userId': userId }] });
    if (!proj) { res.status(404).json({ error: 'Project not found' }); return; }
    const me = await User.findOne({ id: userId }).select('name username avatarUrl -_id');
    const comment = { id: 'cmt_' + uid(), userId, username: me.username || '', name: me.name, avatarUrl: me.avatarUrl || '', text: text.trim().slice(0, 1000), mentions, createdAt: new Date() };
    await Project.updateOne({ id: projectId, 'tasks.id': taskId }, { $push: { 'tasks.$.comments': comment } });
    const task = proj.tasks.find(t => t.id === taskId);
    const notifBase = { fromUserId: userId, fromUsername: me.username || '', fromName: me.name, fromAvatarUrl: me.avatarUrl || '', status: 'pending' };
    const allNotifs = [];
    // @mention notifications
    let mentionedUserIds = new Set();
    if (mentions.length) {
      const mentionedUsers = await User.find({ username: { $in: mentions } }).select('id -_id').lean();
      mentionedUsers.filter(u => u.id !== userId).forEach(u => {
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
    if (allNotifs.length) await Notification.insertMany(allNotifs);
    emitProjectUpdate(req, projectId);
    res.json({ ok: true, comment });
    return;
  }

  // ── reorder_spaces ──
  if (action === 'reorder_spaces') {
    const { order } = req.body;
    if (!Array.isArray(order)) { res.status(400).json({ error: 'Invalid order' }); return; }
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
