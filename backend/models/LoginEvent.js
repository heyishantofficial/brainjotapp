const mongoose = require('mongoose');

// Every login attempt, success or failure — the history behind the admin
// Security page. (LoginAttempt is only a short-lived lockout counter; this is
// the durable record.) deviceKey = hash of user-agent + IP, used to detect a
// superadmin signing in from a device we've never seen. TTL 90 days.
const schema = new mongoose.Schema({
  userId: { type: String, default: null },   // null when the email didn't match a user
  email: { type: String, default: '', lowercase: true, trim: true },
  ok: { type: Boolean, required: true },
  method: { type: String, default: 'password' }, // 'password' | 'google' | 'otp' | 'otp_signup'
  ip: { type: String, default: '' },
  deviceKey: { type: String, default: '' },
  at: { type: Date, default: Date.now },
});

schema.index({ at: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
schema.index({ userId: 1, ok: 1, deviceKey: 1 });
schema.index({ ok: 1, at: -1 });

module.exports = mongoose.model('LoginEvent', schema);
