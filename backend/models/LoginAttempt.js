const mongoose = require('mongoose');

// Tracks consecutive failed password logins per email.
// Documents expire automatically 1 hour after the first failure (TTL index on expiresAt).
// On successful login the document is deleted immediately to reset the counter.
const schema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  count:     { type: Number, default: 0 },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 60 * 60 * 1000) },
});

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('LoginAttempt', schema);
