const mongoose = require('mongoose');

// One row per user per active week. This is the raw material for growth
// accounting (new/retained/resurrected/churned) and cohort retention — numbers
// that need HISTORY, which a single lastSeenAt field can never give back.
// Written by the throttled activity touch in requireAuth; ~1 upsert per user
// per 30 min at most, and the unique index makes repeats free.
const schema = new mongoose.Schema({
  userId: { type: String, required: true },
  week: { type: String, required: true },      // Monday of the week, 'YYYY-MM-DD'
  weekStart: { type: Date, required: true },
});

schema.index({ userId: 1, week: 1 }, { unique: true });
schema.index({ weekStart: 1 });

module.exports = mongoose.model('UserActivity', schema);
