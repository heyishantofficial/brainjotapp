const mongoose = require('mongoose');

const spaceCollaboratorSchema = new mongoose.Schema({
  id:        String,
  userId:    String,
  name:      String,
  username:  String,
  email:     String,
  role:      { type: String, default: 'editor' },
  avatarUrl: String,
  joinedAt:  { type: Date, default: Date.now },
}, { _id: false });

const spaceSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  icon: { type: String, default: '📁' },
  color: { type: String, default: '#6366f1' },
  description: { type: String, default: '' },
  __orderRank: { type: Number, default: 0 },
  ownerId: { type: String, index: true },
  collaborators: { type: [spaceCollaboratorSchema], default: [] },
  inviteToken: { type: String, default: '' },
  inviteLinkRole: { type: String, default: 'editor' },
  inviteTokenExpiry: { type: Date, default: null },
});

spaceSchema.index({ 'collaborators.userId': 1 });
spaceSchema.index({ inviteToken: 1 }, { sparse: true });

module.exports = mongoose.model('Space', spaceSchema);
