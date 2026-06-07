const mongoose = require('mongoose');

const inviteSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  entityId: { type: String, required: true },
  entityType: { type: String, enum: ['project', 'space'], required: true },
  role: { type: String, enum: ['editor', 'viewer'], default: 'editor' },
  invitedBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 30 * 24 * 60 * 60 } // Expire in 30 days
});

module.exports = mongoose.model('Invite', inviteSchema);
