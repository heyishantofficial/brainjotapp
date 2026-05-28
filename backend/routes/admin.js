const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const Space = require('../models/Space');
const Feedback = require('../models/Feedback');
const requireAdmin = require('../middleware/requireAdmin');

const router = express.Router();
router.use(requireAdmin);

// ── Overview stats ──
router.get('/stats', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const [userCount, projectCount, feedbackCount, feedbackOpen] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Feedback.countDocuments(),
      Feedback.countDocuments({ status: 'open' }),
    ]);

    const taskAgg = await Project.aggregate([
      { $project: { taskCount: { $size: { $ifNull: ['$tasks', []] } } } },
      { $group: { _id: null, total: { $sum: '$taskCount' } } },
    ]);
    const taskCount = taskAgg[0]?.total || 0;

    const sessionCount = await db.collection('sessions').countDocuments({
      expires: { $gt: new Date() },
    });

    const dbStats = await db.stats();

    res.json({
      userCount,
      projectCount,
      taskCount,
      feedbackCount,
      feedbackOpen,
      sessionCount,
      dbSizeMB: (dbStats.dataSize / 1024 / 1024).toFixed(2),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List all users ──
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}).select('-passwordHash -__v').lean();
    const projectCounts = await Project.aggregate([
      { $group: { _id: '$ownerId', count: { $sum: 1 } } },
    ]);
    const pcMap = Object.fromEntries(projectCounts.map(p => [p._id, p.count]));

    res.json({
      users: users.map(u => ({ ...u, projectCount: pcMap[u.id] || 0 })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Grant superadmin by email ──
router.post('/users/grant', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { role: 'superadmin' },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'No user with that email' });
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Revoke superadmin ──
router.post('/users/:id/revoke', async (req, res) => {
  try {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ error: 'Cannot revoke your own superadmin role' });
    }
    const user = await User.findOneAndUpdate({ id: req.params.id }, { role: 'user' }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete user + all their data ──
router.delete('/users/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await Promise.all([
      User.deleteOne({ id: targetId }),
      Project.deleteMany({ ownerId: targetId }),
      Space.deleteMany({ ownerId: targetId }),
      Feedback.deleteMany({ userId: targetId }),
    ]);
    // Force-expire all sessions for this user
    const db = mongoose.connection.db;
    const allSessions = await db.collection('sessions').find({}).toArray();
    const sessionIds = allSessions
      .filter(s => { try { return JSON.parse(s.session).userId === targetId; } catch { return false; } })
      .map(s => s._id);
    if (sessionIds.length) {
      await db.collection('sessions').deleteMany({ _id: { $in: sessionIds } });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Active sessions ──
router.get('/sessions', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const raw = await db.collection('sessions').find({ expires: { $gt: new Date() } }).toArray();

    const userIds = raw.map(s => {
      try { return JSON.parse(s.session).userId; } catch { return null; }
    }).filter(Boolean);

    const users = await User.find({ id: { $in: userIds } }).select('id email name -_id').lean();
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const sessions = raw.map(s => {
      let userId = null;
      try { userId = JSON.parse(s.session).userId; } catch {}
      if (!userId) return null;
      const u = userMap[userId];
      return {
        sessionId: s._id.toString(),
        userId,
        userName: u?.name || 'Unknown',
        userEmail: u?.email || 'Unknown',
        expires: s.expires,
        isSelf: userId === req.session.userId,
      };
    }).filter(Boolean);

    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Force-logout a session ──
router.delete('/sessions/:id', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    await db.collection('sessions').deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── All feedback (admin view) ──
router.get('/feedback', async (req, res) => {
  try {
    const items = await Feedback.find({}).sort({ createdAt: -1 }).lean();
    res.json({
      items: items.map(({ _id, __v, upvotes, ...rest }) => ({
        ...rest,
        upvoteCount: (upvotes || []).length,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Delete feedback item ──
router.delete('/feedback/:id', async (req, res) => {
  try {
    await Feedback.deleteOne({ id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── System info ──
router.get('/system', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const collectionNames = await db.listCollections().toArray();

    const collStats = await Promise.all(
      collectionNames.map(async c => {
        try {
          const stats = await db.collection(c.name).stats();
          return { name: c.name, count: stats.count, sizeMB: (stats.size / 1024 / 1024).toFixed(3) };
        } catch {
          return { name: c.name, count: '?', sizeMB: '?' };
        }
      })
    );

    const envHealth = {
      MONGODB_URI:         !!process.env.MONGODB_URI,
      SESSION_SECRET:      !!process.env.SESSION_SECRET,
      ADMIN_EMAILS:        !!process.env.ADMIN_EMAILS,
      R2_ACCOUNT_ID:       !!process.env.R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID:    !!process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY:!!process.env.R2_SECRET_ACCESS_KEY,
      R2_BUCKET_NAME:      !!process.env.R2_BUCKET_NAME,
      RESEND_API_KEY:      !!process.env.RESEND_API_KEY,
      APP_URL:             !!process.env.APP_URL,
    };

    res.json({
      collections: collStats,
      envHealth,
      nodeVersion: process.version,
      uptime: Math.floor(process.uptime()),
      nodeEnv: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
