const crypto = require('crypto');
const mongoose = require('mongoose');
const LoginEvent = require('../models/LoginEvent');
const { sendPushToUser } = require('./push');
const logger = require('./logger');

// ── Login history + superadmin new-device alerts ──────────────────
// Records every attempt (Security page reads these), and when a SUPERADMIN
// succeeds from a user-agent+IP combination we've never seen, pushes a warning
// to their own devices and drops an audit_log entry. If someone steals the
// account password, the real owner's phone lights up.

function deviceKeyFor(req) {
  return crypto.createHash('sha256')
    .update(`${req.headers['user-agent'] || ''}|${req.ip || ''}`)
    .digest('hex').slice(0, 16);
}

async function recordLogin(req, { user = null, email = '', ok, method }) {
  try {
    const deviceKey = deviceKeyFor(req);
    const ev = await LoginEvent.create({
      userId: user?.id || null,
      email: (email || user?.email || '').toLowerCase(),
      ok,
      method,
      ip: req.ip || '',
      deviceKey,
    });

    if (ok && user?.role === 'superadmin') {
      const prior = await LoginEvent.findOne({
        userId: user.id, ok: true, deviceKey, _id: { $ne: ev._id },
      }).select('_id').lean();
      if (!prior) {
        mongoose.connection.db.collection('audit_log').insertOne({
          adminId: user.id,
          action: 'admin_new_device_login',
          target: user.id,
          meta: { method, ip: req.ip || '', deviceKey },
          timestamp: new Date(),
          expireAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        }).catch(() => {});
        sendPushToUser(user.id, {
          title: '⚠️ New device sign-in (superadmin)',
          body: `Your superadmin account signed in from a new device or network (${method}). If this wasn't you, change your password immediately.`,
          url: '/',
          icon: '/icons/icon-192.png',
          tag: 'admin-new-device',
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, '[login-events] record failed (non-fatal)');
  }
}

module.exports = { recordLogin };
