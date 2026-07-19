const mongoose = require('mongoose');

// One row each time a rate limiter fires — the Security page charts these.
// A spike on 'auth' = someone hammering the login; on 'api' = a runaway
// client or a scraper. TTL 30 days.
const schema = new mongoose.Schema({
  name: { type: String, required: true },   // 'auth' | 'api' | 'export' | 'admin_unlock'
  userId: { type: String, default: null },
  ip: { type: String, default: '' },
  at: { type: Date, default: Date.now },
});

schema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
schema.index({ name: 1, at: -1 });

module.exports = mongoose.model('RateLimitTrip', schema);
