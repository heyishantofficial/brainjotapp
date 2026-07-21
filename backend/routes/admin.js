const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const User = require('../models/User');
const Project = require('../models/Project');
const Space = require('../models/Space');
const Feedback = require('../models/Feedback');
const requireAdmin = require('../middleware/requireAdmin');
const { deleteUserFiles } = require('../utils/storage');
const Invite = require('../models/Invite');
const LoginEvent = require('../models/LoginEvent');
const LoginAttempt = require('../models/LoginAttempt');
const RateLimitTrip = require('../models/RateLimitTrip');
const UserActivity = require('../models/UserActivity');
const { mondayOf } = require('../utils/activity');

async function auditLog(db, adminId, action, target, meta = {}) {
  try {
    // expireAt drives the TTL index — entries auto-delete after 1 year
    const expireAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await db.collection('audit_log').insertOne({ adminId, action, target, meta, timestamp: new Date(), expireAt });
  } catch { /* never let audit failure break the response */ }
}

const router = express.Router();
router.use(requireAdmin);

// ── Sudo unlock ───────────────────────────────────────────────────
// The dashboard needs a second password (ADMIN_DASH_PASSWORD) on top of the
// superadmin session, so a stolen brainjot login alone can't reach it. The
// unlock lasts 30 minutes per session; everything below the gate 401s with
// code ADMIN_LOCKED until then. Fail-closed when the env var is unset.
const ADMIN_UNLOCK_TTL = 30 * 60 * 1000;

function adminUnlocked(req) {
  const at = req.session?.adminUnlockedAt;
  return typeof at === 'number' && Date.now() - at < ADMIN_UNLOCK_TTL;
}

// Hash both sides so timingSafeEqual gets equal-length buffers.
function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(process.env.ADMIN_DASH_PASSWORD)).digest();
  return crypto.timingSafeEqual(a, b);
}

// A password oracle gets a much tighter budget than the general apiLimiter.
const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.session?.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    RateLimitTrip.create({ name: 'admin_unlock', userId: req.session?.userId || null, ip: req.ip || '' }).catch(() => {});
    res.status(429).json({ error: 'Too many attempts, please try again later' });
  },
});

router.get('/unlock-status', (req, res) => {
  res.json({ configured: !!process.env.ADMIN_DASH_PASSWORD, unlocked: adminUnlocked(req) });
});

router.post('/unlock', unlockLimiter, async (req, res) => {
  if (!process.env.ADMIN_DASH_PASSWORD) {
    return res.status(503).json({ error: 'Admin password not configured on the server', code: 'ADMIN_PASSWORD_UNSET' });
  }
  const ok = passwordMatches(req.body?.password);
  // Both outcomes are audited — a run of failures IS the signal that someone
  // is sitting on a hijacked superadmin session.
  await auditLog(mongoose.connection.db, req.session.userId, ok ? 'admin_unlock' : 'admin_unlock_failed', req.session.userId);
  if (!ok) return res.status(401).json({ error: 'Wrong password' });
  req.session.adminUnlockedAt = Date.now();
  res.json({ ok: true });
});

router.use((req, res, next) => {
  if (!process.env.ADMIN_DASH_PASSWORD) {
    return res.status(503).json({ error: 'Admin password not configured on the server', code: 'ADMIN_PASSWORD_UNSET' });
  }
  if (!adminUnlocked(req)) {
    return res.status(401).json({ error: 'Admin unlock required', code: 'ADMIN_LOCKED' });
  }
  next();
});

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
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    const db = mongoose.connection.db;
    await auditLog(db, req.session.userId, 'grant_admin', user.id, { email: user.email });
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    // Force-expire all sessions for this user so the revocation takes effect immediately.
    // Filter at MongoDB level with a regex — avoids O(N) full scan in Node.
    const db = mongoose.connection.db;
    const staleSessions = await db.collection('sessions').find(
      { session: { $regex: `"userId":"${req.params.id}"` } },
      { projection: { _id: 1 } }
    ).toArray();
    const toDelete = staleSessions.map(s => s._id);
    if (toDelete.length) await db.collection('sessions').deleteMany({ _id: { $in: toDelete } });
    await auditLog(db, req.session.userId, 'revoke_admin', req.params.id, { email: user.email });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete user + all their data ──
router.delete('/users/:id', async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    const targetUser = await User.findOne({ id: targetId }).select('email -_id').lean();
    // Delete stored files before removing documents
    const userProjects = await Project.find({ ownerId: targetId }).select('files tasks').lean();
    await deleteUserFiles(targetId, userProjects);
    await Promise.all([
      User.deleteOne({ id: targetId }),
      Project.deleteMany({ ownerId: targetId }),
      Space.deleteMany({ ownerId: targetId }),
      Feedback.deleteMany({ userId: targetId }),
      // Remove this user from collaborator lists on other users' projects and spaces
      // (same cleanup that self-delete performs — previously missing from admin path)
      Project.updateMany({ 'collaborators.userId': targetId }, { $pull: { collaborators: { userId: targetId } } }),
      Space.updateMany({ 'collaborators.userId': targetId }, { $pull: { collaborators: { userId: targetId } } }),
    ]);
    // Force-expire all sessions for this user — filter at MongoDB level, not in Node
    const db = mongoose.connection.db;
    const staleSessions = await db.collection('sessions').find(
      { session: { $regex: `"userId":"${targetId}"` } },
      { projection: { _id: 1 } }
    ).toArray();
    const sessionIds = staleSessions.map(s => s._id);
    if (sessionIds.length) {
      await db.collection('sessions').deleteMany({ _id: { $in: sessionIds } });
    }
    await auditLog(db, req.session.userId, 'delete_user', targetId, { email: targetUser?.email });
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Force-logout a session ──
router.delete('/sessions/:id', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    // connect-mongo v6 stores sessions with a string _id (the session ID)
    const result = await db.collection('sessions').deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found or already expired' });
    await auditLog(db, req.session.userId, 'force_logout_session', req.params.id, {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Delete feedback item ──
router.delete('/feedback/:id', async (req, res) => {
  try {
    await Feedback.deleteOne({ id: req.params.id });
    const db = mongoose.connection.db;
    await auditLog(db, req.session.userId, 'delete_feedback', req.params.id, {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
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
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Analytics (charts + distributions) ──
function fillDays(raw, days) {
  const map = Object.fromEntries(raw.map(d => [d._id, d.count]));
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    result.push({ date: d.toISOString().split('T')[0], count: map[d.toISOString().split('T')[0]] || 0 });
  }
  return result;
}

router.get('/analytics', async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const nowStr = new Date().toISOString();
    const db = mongoose.connection.db;

    const [
      userGrowthRaw,
      feedbackTrendRaw,
      taskAgg,
      projectCountsAgg,
      taskCountsAgg,
      fileAgg,
      spaceProjectAgg,
      recentSignups,
      sessionCount,
      dbStats,
    ] = await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Feedback.aggregate([
        { $match: { createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      Project.aggregate([
        { $unwind: { path: '$tasks', preserveNullAndEmptyArrays: false } },
        { $group: {
          _id: null,
          total:     { $sum: 1 },
          done:      { $sum: { $cond: ['$tasks.done', 1, 0] } },
          urgent:    { $sum: { $cond: [{ $eq: ['$tasks.priority', 'urgent'] }, 1, 0] } },
          important: { $sum: { $cond: [{ $eq: ['$tasks.priority', 'important'] }, 1, 0] } },
          later:     { $sum: { $cond: [{ $eq: ['$tasks.priority', 'later'] }, 1, 0] } },
          overdue:   { $sum: { $cond: [{ $and: [
            { $eq: ['$tasks.done', false] },
            { $gt: ['$tasks.deadline', ''] },
            { $lt: ['$tasks.deadline', nowStr] },
          ]}, 1, 0] } },
        }},
      ]),
      Project.aggregate([
        { $group: { _id: '$ownerId', projectCount: { $sum: 1 } } },
        { $sort: { projectCount: -1 } },
        { $limit: 10 },
      ]),
      Project.aggregate([
        { $project: { ownerId: 1, taskCount: { $size: { $ifNull: ['$tasks', []] } } } },
        { $group: { _id: '$ownerId', taskCount: { $sum: '$taskCount' } } },
      ]),
      Project.aggregate([
        { $project: { fileCount: { $size: { $ifNull: ['$files', []] } } } },
        { $group: { _id: null, total: { $sum: '$fileCount' } } },
      ]),
      Project.aggregate([
        { $group: { _id: '$spaceId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      User.find({}).sort({ createdAt: -1 }).limit(6).select('id name email role createdAt -_id').lean(),
      db.collection('sessions').countDocuments({ expires: { $gt: new Date() } }),
      db.stats(),
    ]);

    // Top users — join project + task counts
    const taskCountMap = Object.fromEntries(taskCountsAgg.map(t => [t._id, t.taskCount]));
    const topUserIds   = projectCountsAgg.map(p => p._id);
    const topUserDocs  = await User.find({ id: { $in: topUserIds } }).select('id name email -_id').lean();
    const topUserMap   = Object.fromEntries(topUserDocs.map(u => [u.id, u]));
    const topUsers     = projectCountsAgg
      .map(p => ({ ...topUserMap[p._id], projectCount: p.projectCount, taskCount: taskCountMap[p._id] || 0 }))
      .filter(u => u.name);

    // Space distribution — join space titles
    const spaceIds  = spaceProjectAgg.map(s => s._id).filter(Boolean);
    const spaceDocs = await Space.find({ id: { $in: spaceIds } }).select('id title -_id').lean();
    const spaceMap  = Object.fromEntries(spaceDocs.map(s => [s.id, s]));
    const spaceDistribution = spaceProjectAgg.map(s => ({
      title: spaceMap[s._id]?.title || 'Unnamed',
      count: s.count,
    }));

    // Overall counts
    const [userCount, projectCount, archivedCount, feedbackOpen, feedbackTotal] = await Promise.all([
      User.countDocuments(),
      Project.countDocuments(),
      Project.countDocuments({ archived: true }),
      Feedback.countDocuments({ status: 'open' }),
      Feedback.countDocuments(),
    ]);

    const ts = taskAgg[0] || { total: 0, done: 0, urgent: 0, important: 0, later: 0, overdue: 0 };

    res.json({
      counts: {
        users:           userCount,
        projects:        projectCount,
        archivedProjects:archivedCount,
        tasks:           ts.total,
        tasksDone:       ts.done,
        tasksOpen:       ts.total - ts.done,
        tasksOverdue:    ts.overdue,
        files:           fileAgg[0]?.total || 0,
        feedbackOpen,
        feedbackTotal,
        activeSessions:  sessionCount,
        dbSizeMB:        (dbStats.dataSize / 1024 / 1024).toFixed(2),
      },
      taskPriority: {
        urgent:    ts.urgent,
        important: ts.important,
        later:     ts.later,
        none:      Math.max(0, ts.total - ts.urgent - ts.important - ts.later),
      },
      completionRate: ts.total ? Math.round(ts.done / ts.total * 100) : 0,
      userGrowth:      fillDays(userGrowthRaw, 30),
      feedbackTrend:   fillDays(feedbackTrendRaw, 30),
      topUsers,
      spaceDistribution,
      recentSignups,
    });
  } catch (err) {
    console.error('[admin]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Sentry issues ──
router.get('/sentry', async (req, res) => {
  const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
  if (!SENTRY_AUTH_TOKEN || !SENTRY_ORG || !SENTRY_PROJECT) {
    return res.json({ configured: false, issues: [] });
  }
  try {
    const url = `https://sentry.io/api/0/projects/${encodeURIComponent(SENTRY_ORG)}/${encodeURIComponent(SENTRY_PROJECT)}/issues/?limit=25&query=is%3Aunresolved&sort=date`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` } });
    if (!r.ok) {
      console.error('[admin/sentry] API error:', r.status);
      return res.json({ configured: false, issues: [], error: 'Sentry API returned ' + r.status });
    }
    const raw = await r.json();
    res.json({
      configured: true,
      issues: raw.map(i => ({
        id:        i.id,
        title:     i.title,
        culprit:   i.culprit,
        count:     i.count,
        userCount: i.userCount,
        firstSeen: i.firstSeen,
        lastSeen:  i.lastSeen,
        level:     i.level,
        permalink: i.permalink,
      })),
    });
  } catch (err) {
    console.error('[admin/sentry]', err);
    res.status(500).json({ configured: true, issues: [], error: err.message });
  }
});

// ── Growth: accounting, cohorts, activation funnel ──
// All computed from DB truth. Weekly activity history comes from UserActivity,
// which only started recording when this shipped — accounting and cohorts
// become fully accurate after 2+ weeks of data (the funnel is exact already).
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const wkey = (d) => mondayOf(d).toISOString().slice(0, 10);

router.get('/growth', async (req, res) => {
  try {
    const now = Date.now();
    const thisMonday = mondayOf(new Date());
    const lastMonday = new Date(thisMonday.getTime() - WEEK);
    const thisKey = wkey(thisMonday);
    const lastKey = wkey(lastMonday);

    // Weekly growth accounting.
    const [activeThis, activeLast, newThisWeek] = await Promise.all([
      UserActivity.distinct('userId', { week: thisKey }),
      UserActivity.distinct('userId', { week: lastKey }),
      User.countDocuments({ createdAt: { $gte: thisMonday } }),
    ]);
    const lastSet = new Set(activeLast);
    const thisSet = new Set(activeThis);
    const retained = activeThis.filter((id) => lastSet.has(id)).length;
    const churned = activeLast.filter((id) => !thisSet.has(id)).length;
    // Active this week, not last week → either brand new or resurrected.
    const candidates = activeThis.filter((id) => !lastSet.has(id));
    const resurrected = candidates.length
      ? await User.countDocuments({ id: { $in: candidates }, createdAt: { $lt: lastMonday } })
      : 0;
    const quickRatio = churned > 0 ? +(((newThisWeek + resurrected) / churned).toFixed(2)) : null;

    // Cohort retention: last 8 signup weeks × weeks-since-signup activity %.
    const cohortStart = new Date(thisMonday.getTime() - 7 * WEEK);
    const cohortUsers = await User.find({ createdAt: { $gte: cohortStart } }).select('id createdAt -_id').lean();
    const activity = cohortUsers.length
      ? await UserActivity.find({ userId: { $in: cohortUsers.map((u) => u.id) } }).select('userId week -_id').lean()
      : [];
    const activeWeeksByUser = new Map();
    for (const a of activity) {
      if (!activeWeeksByUser.has(a.userId)) activeWeeksByUser.set(a.userId, new Set());
      activeWeeksByUser.get(a.userId).add(a.week);
    }
    const cohorts = [];
    for (let w = 7; w >= 0; w--) {
      const start = new Date(thisMonday.getTime() - w * WEEK);
      const members = cohortUsers.filter((u) => wkey(u.createdAt) === wkey(start));
      const cells = [];
      for (let offset = 0; offset <= w; offset++) {
        const key = wkey(new Date(start.getTime() + offset * WEEK));
        const active = members.filter((u) => activeWeeksByUser.get(u.id)?.has(key)).length;
        cells.push(members.length ? Math.round((active / members.length) * 100) : null);
      }
      cohorts.push({ week: wkey(start), size: members.length, cells });
    }

    // Activation funnel over the same 8 weeks of signups.
    const ids = cohortUsers.map((u) => u.id);
    const signupAt = new Map(cohortUsers.map((u) => [u.id, new Date(u.createdAt).getTime()]));
    const [projectOwners, taskRows, inviters] = ids.length ? await Promise.all([
      Project.distinct('ownerId', { ownerId: { $in: ids } }),
      Project.aggregate([
        { $match: { ownerId: { $in: ids } } },
        { $unwind: '$tasks' },
        { $project: { _id: 0, ownerId: 1, finishedAt: '$tasks.finishedAt' } },
      ]),
      Invite.distinct('invitedBy', { invitedBy: { $in: ids } }),
    ]) : [[], [], []];
    const hasTask = new Set(taskRows.map((r) => r.ownerId));
    // Activation = 5+ tasks finished within 7 days of signup.
    const finishedInWk1 = new Map();
    for (const r of taskRows) {
      if (!r.finishedAt) continue;
      const t0 = signupAt.get(r.ownerId);
      if (t0 != null && new Date(r.finishedAt).getTime() - t0 <= 7 * DAY) {
        finishedInWk1.set(r.ownerId, (finishedInWk1.get(r.ownerId) || 0) + 1);
      }
    }
    const activated = [...finishedInWk1.values()].filter((n) => n >= 5).length;
    // Returned = active in the week after their signup week.
    const returned = cohortUsers.filter((u) => {
      const nextWeek = wkey(new Date(mondayOf(u.createdAt).getTime() + WEEK));
      return activeWeeksByUser.get(u.id)?.has(nextWeek);
    }).length;

    // ── K-factor (lifetime snapshot) ──────────────────────────────────
    // Collaborator entries carry no historical "when generated" trail for
    // link-based invites (the token is cleared on use), so this is a
    // whole-history snapshot, not a weekly trend. The PostHog events
    // invite_sent/invite_accepted (wired client-side) are what will let a
    // real week-over-week K-factor trend be built once enough weeks accrue.
    const totalUsersAllTime = await User.countDocuments();
    const [projCollabAgg, spaceCollabAgg, projInviters, spaceInviters] = await Promise.all([
      Project.aggregate([
        { $project: { n: { $size: { $ifNull: ['$collaborators', []] } } } },
        { $group: { _id: null, total: { $sum: '$n' } } },
      ]),
      Space.aggregate([
        { $project: { n: { $size: { $ifNull: ['$collaborators', []] } } } },
        { $group: { _id: null, total: { $sum: '$n' } } },
      ]),
      Project.distinct('ownerId', { 'collaborators.0': { $exists: true } }),
      Space.distinct('ownerId', { 'collaborators.0': { $exists: true } }),
    ]);
    const acceptedTotal = (projCollabAgg[0]?.total || 0) + (spaceCollabAgg[0]?.total || 0);
    const inviterUsers = new Set([...projInviters, ...spaceInviters]).size;
    const kfactor = {
      acceptedLifetime: acceptedTotal,
      inviterUsers,
      totalUsers: totalUsersAllTime,
      avgAcceptedPerUser: totalUsersAllTime ? +(acceptedTotal / totalUsersAllTime).toFixed(2) : null,
      inviterRatePct: totalUsersAllTime ? Math.round((inviterUsers / totalUsersAllTime) * 100) : null,
    };

    // ── Time-to-value (last 90 days of signups) ───────────────────────
    // Median minutes to a user's first-ever task, and median hours to their
    // first completed task. Approximate for shared projects: a task a
    // COLLABORATOR creates on someone else's project doesn't count toward
    // that collaborator's time-to-value (tasks have no per-task creator
    // field) — this measures the OWNER's path, which is the common case.
    const d90 = new Date(now - 90 * DAY);
    const recentUsers = await User.find({ createdAt: { $gte: d90 } }).select('id createdAt -_id').lean();
    const recentIds = recentUsers.map((u) => u.id);
    const recentSignupAt = new Map(recentUsers.map((u) => [u.id, new Date(u.createdAt).getTime()]));
    const [firstTaskRows, firstDoneRows] = recentIds.length ? await Promise.all([
      Project.aggregate([
        { $match: { ownerId: { $in: recentIds } } },
        { $unwind: '$tasks' },
        { $group: { _id: '$ownerId', firstTaskAt: { $min: '$tasks.createdAt' } } },
      ]),
      Project.aggregate([
        { $match: { ownerId: { $in: recentIds }, 'tasks.finishedAt': { $ne: null } } },
        { $unwind: '$tasks' },
        { $match: { 'tasks.finishedAt': { $ne: null } } },
        { $group: { _id: '$ownerId', firstDoneAt: { $min: '$tasks.finishedAt' } } },
      ]),
    ]) : [[], []];
    const median = (arr) => {
      if (!arr.length) return null;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const taskMins = firstTaskRows
      .map((r) => (new Date(r.firstTaskAt).getTime() - recentSignupAt.get(r._id)) / 60000)
      .filter((v) => v >= 0);
    const doneHours = firstDoneRows
      .map((r) => (new Date(r.firstDoneAt).getTime() - recentSignupAt.get(r._id)) / 3600000)
      .filter((v) => v >= 0);
    const timeToValue = {
      windowDays: 90,
      sampleSize: taskMins.length,
      medianMinutesToFirstTask: taskMins.length ? Math.round(median(taskMins)) : null,
      medianHoursToFirstCompletion: doneHours.length ? +median(doneHours).toFixed(1) : null,
    };

    // ── Activation proof: does the 5-tasks-in-week-1 definition predict
    // week-4 retention? Restricted to signups old enough to HAVE a week 4. ──
    const fourWeeksAgo = new Date(thisMonday.getTime() - 4 * WEEK);
    const matureCohort = cohortUsers.filter((u) => new Date(u.createdAt) <= fourWeeksAgo);
    const isActivated = (u) => (finishedInWk1.get(u.id) || 0) >= 5;
    const activeAtWeek4 = (u) => {
      const wk4 = wkey(new Date(mondayOf(u.createdAt).getTime() + 4 * WEEK));
      return activeWeeksByUser.get(u.id)?.has(wk4) || false;
    };
    const activatedMature = matureCohort.filter(isActivated);
    const nonActivatedMature = matureCohort.filter((u) => !isActivated(u));
    const activationProof = {
      cohortSize: matureCohort.length,
      activatedCount: activatedMature.length,
      activatedWeek4RetentionPct: activatedMature.length
        ? Math.round((activatedMature.filter(activeAtWeek4).length / activatedMature.length) * 100) : null,
      nonActivatedWeek4RetentionPct: nonActivatedMature.length
        ? Math.round((nonActivatedMature.filter(activeAtWeek4).length / nonActivatedMature.length) * 100) : null,
    };

    // ── Collaboration depth: are shared-project users stickier week over
    // week than solo users? Uses ALL active users this week, not just the
    // 8-week signup cohort. ──
    const [ownerWithCollabProj, ownerWithCollabSpace, memberOfProj, memberOfSpace] = activeThis.length
      ? await Promise.all([
        Project.distinct('ownerId', { ownerId: { $in: activeThis }, 'collaborators.0': { $exists: true } }),
        Space.distinct('ownerId', { ownerId: { $in: activeThis }, 'collaborators.0': { $exists: true } }),
        Project.distinct('collaborators.userId', { 'collaborators.userId': { $in: activeThis } }),
        Space.distinct('collaborators.userId', { 'collaborators.userId': { $in: activeThis } }),
      ]) : [[], [], [], []];
    const inSharedSet = new Set([...ownerWithCollabProj, ...ownerWithCollabSpace, ...memberOfProj, ...memberOfSpace]);
    const soloActiveThis = activeThis.filter((id) => !inSharedSet.has(id));
    const collabDepth = {
      activeUsersThisWeek: activeThis.length,
      inSharedCount: inSharedSet.size,
      inSharedPct: activeThis.length ? Math.round((inSharedSet.size / activeThis.length) * 100) : null,
      collabWeekOverWeekRetentionPct: inSharedSet.size
        ? Math.round(([...inSharedSet].filter((id) => lastSet.has(id)).length / inSharedSet.size) * 100) : null,
      soloWeekOverWeekRetentionPct: soloActiveThis.length
        ? Math.round((soloActiveThis.filter((id) => lastSet.has(id)).length / soloActiveThis.length) * 100) : null,
    };

    // ── Task engine: created vs completed (14d trend), completion ratio,
    // overdue ratio (bounded sample for cost — see comment below). ──
    // Anchored to TODAY, not thisMonday — a weekly-bucket anchor here would
    // silently drop every day between the most recent Monday and today.
    const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
    const seriesStart14 = new Date(todayUTC.getTime() - 13 * DAY);
    const taskDateRows = await Project.aggregate([
      { $match: { $or: [{ 'tasks.createdAt': { $gte: seriesStart14 } }, { 'tasks.finishedAt': { $gte: seriesStart14 } }] } },
      { $unwind: '$tasks' },
      { $match: { $or: [{ 'tasks.createdAt': { $gte: seriesStart14 } }, { 'tasks.finishedAt': { $gte: seriesStart14 } }] } },
      { $project: { _id: 0, createdAt: '$tasks.createdAt', finishedAt: '$tasks.finishedAt' } },
    ]);
    const createdByDay = {};
    const completedByDay = {};
    for (const r of taskDateRows) {
      if (r.createdAt >= seriesStart14) {
        const k = new Date(r.createdAt).toISOString().slice(0, 10);
        createdByDay[k] = (createdByDay[k] || 0) + 1;
      }
      if (r.finishedAt && r.finishedAt >= seriesStart14) {
        const k = new Date(r.finishedAt).toISOString().slice(0, 10);
        completedByDay[k] = (completedByDay[k] || 0) + 1;
      }
    }
    const taskSeries = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(seriesStart14.getTime() + i * DAY).toISOString().slice(0, 10);
      return { day, created: createdByDay[day] || 0, completed: completedByDay[day] || 0 };
    });
    const createdSum = taskSeries.reduce((s, d) => s + d.created, 0);
    const completedSum = taskSeries.reduce((s, d) => s + d.completed, 0);
    // Overdue ratio: sampled at 20k open tasks — a ratio, not a count, so a
    // bounded sample is fine and keeps this cheap as task volume grows.
    const openTaskRows = await Project.aggregate([
      { $match: { 'tasks.done': false } },
      { $unwind: '$tasks' },
      { $match: { 'tasks.done': false } },
      { $project: { _id: 0, deadline: '$tasks.deadline' } },
      { $limit: 20000 },
    ]);
    let overdueCount = 0;
    for (const r of openTaskRows) {
      const d = r.deadline ? new Date(r.deadline) : null;
      if (d && !isNaN(d) && d.getTime() < now) overdueCount++;
    }
    const taskEngine = {
      series14d: taskSeries,
      completionRatioPct: createdSum ? Math.round((completedSum / createdSum) * 100) : null,
      overdueOpenPct: openTaskRows.length ? Math.round((overdueCount / openTaskRows.length) * 100) : null,
      overdueSampleSize: openTaskRows.length,
    };

    res.json({
      accounting: {
        weekOf: thisKey,
        activeThisWeek: activeThis.length,
        activeLastWeek: activeLast.length,
        new: newThisWeek,
        retained,
        resurrected,
        churned,
        quickRatio,
      },
      cohorts,
      funnel: {
        windowWeeks: 8,
        signedUp: ids.length,
        createdProject: projectOwners.length,
        createdTask: hasTask.size,
        sentInvite: inviters.length,
        activated,          // 5+ tasks completed within week 1
        returnedWeek2: returned,
      },
      kfactor,
      timeToValue,
      activationProof,
      collabDepth,
      taskEngine,
    });
  } catch (err) {
    console.error('[admin/growth]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Audit log viewer ──
router.get('/audit', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const filter = {};
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.adminId) filter.adminId = String(req.query.adminId);
    const [items, total, actions] = await Promise.all([
      db.collection('audit_log').find(filter).sort({ timestamp: -1 }).skip(page * 50).limit(50).toArray(),
      db.collection('audit_log').countDocuments(filter),
      db.collection('audit_log').distinct('action'),
    ]);
    // Resolve admin ids to names for readability.
    const adminIds = [...new Set(items.map((i) => i.adminId).filter(Boolean))];
    const admins = adminIds.length ? await User.find({ id: { $in: adminIds } }).select('id name -_id').lean() : [];
    const nameById = Object.fromEntries(admins.map((a) => [a.id, a.name]));
    res.json({
      items: items.map((i) => ({
        action: i.action,
        adminId: i.adminId,
        adminName: nameById[i.adminId] || i.adminId,
        target: i.target,
        meta: i.meta || {},
        timestamp: i.timestamp,
      })),
      total,
      actions: actions.sort(),
    });
  } catch (err) {
    console.error('[admin/audit]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Security: login history, lockouts, rate-limit trips ──
router.get('/security', async (req, res) => {
  try {
    const since = new Date(Date.now() - 14 * DAY);
    const daily = (rows) => {
      const byDay = Object.fromEntries(rows.map((r) => [r._id, r.n]));
      return Array.from({ length: 14 }, (_, i) => {
        const day = new Date(since.getTime() + (i + 1) * DAY).toISOString().slice(0, 10);
        return { date: day, count: byDay[day] || 0 };
      });
    };
    const dayAgg = (match, dateField) => [
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${dateField}` } }, n: { $sum: 1 } } },
    ];

    const [okRows, failRows, tripRows, recentFailures, lockedOut, unlockFails7d, newDeviceLogins] = await Promise.all([
      LoginEvent.aggregate(dayAgg({ ok: true, at: { $gte: since } }, 'at')),
      LoginEvent.aggregate(dayAgg({ ok: false, at: { $gte: since } }, 'at')),
      RateLimitTrip.aggregate([
        { $match: { at: { $gte: since } } },
        { $group: { _id: '$name', n: { $sum: 1 } } },
      ]),
      LoginEvent.find({ ok: false }).sort({ at: -1 }).limit(20).select('email method ip at -_id').lean(),
      LoginAttempt.countDocuments({ count: { $gte: 10 } }),
      mongoose.connection.db.collection('audit_log')
        .countDocuments({ action: 'admin_unlock_failed', timestamp: { $gte: new Date(Date.now() - 7 * DAY) } }),
      mongoose.connection.db.collection('audit_log')
        .find({ action: 'admin_new_device_login' }).sort({ timestamp: -1 }).limit(10).toArray(),
    ]);

    res.json({
      loginsOk: daily(okRows),
      loginsFailed: daily(failRows),
      trips: tripRows.map((t) => ({ label: t._id, value: t.n })).sort((a, b) => b.value - a.value),
      recentFailures,
      lockedOutEmails: lockedOut,
      adminUnlockFailures7d: unlockFails7d,
      newDeviceLogins: newDeviceLogins.map((e) => ({ adminId: e.adminId, meta: e.meta, timestamp: e.timestamp })),
    });
  } catch (err) {
    console.error('[admin/security]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
