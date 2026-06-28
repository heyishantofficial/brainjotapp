const mongoose = require('mongoose');

// Persists active call state in MongoDB instead of in-process memory.
// Benefits over a Map:
//   - Survives server restarts (callers see a clean ended-call rather than a ghost)
//   - Shared across multiple Railway instances
//   - TTL auto-cleans abandoned calls 2 hours after they start
const activeCallSchema = new mongoose.Schema({
  callId:      { type: String, required: true, unique: true },
  hostUserId:  { type: String, required: true, index: true },
  hostName:    { type: String, required: true },
  callType:    { type: String, required: true },
  roomName:    { type: String, required: true },
  entityType:  { type: String, default: 'project' },
  startedAt:   { type: Date, default: Date.now },
  expiresAt:   { type: Date, default: () => new Date(Date.now() + 2 * 60 * 60 * 1000) },
});

// Auto-delete documents 2 hours after call start — cleans up orphaned calls from crashes
activeCallSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('ActiveCall', activeCallSchema);
