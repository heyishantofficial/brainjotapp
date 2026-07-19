const User = require('../models/User');
const UserActivity = require('../models/UserActivity');

// ── Weekly activity recording ─────────────────────────────────────
// Feeds growth accounting and cohort retention. Called from requireAuth on
// every authenticated request but throttled to one write per session per
// 30 min via a session timestamp — the cost rounds to zero.

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // back to Monday
  return x;
}

function weekKey(d) {
  return mondayOf(d).toISOString().slice(0, 10);
}

function touchActivity(req) {
  const userId = req.session?.userId;
  if (!userId) return;
  const now = Date.now();
  if (req.session.activityTouch && now - req.session.activityTouch < 30 * 60 * 1000) return;
  req.session.activityTouch = now;
  const monday = mondayOf(new Date(now));
  const week = monday.toISOString().slice(0, 10);
  // Fire-and-forget — activity recording must never slow or fail a request.
  UserActivity.updateOne(
    { userId, week },
    { $setOnInsert: { userId, week, weekStart: monday } },
    { upsert: true },
  ).catch(() => {});
  User.updateOne({ id: userId }, { $set: { lastSeenAt: new Date(now) } }).catch(() => {});
}

module.exports = { touchActivity, mondayOf, weekKey };
