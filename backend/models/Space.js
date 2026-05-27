const mongoose = require('mongoose');

const spaceCollaboratorSchema = new mongoose.Schema({
  id:    String,
  name:  String,
  email: String,
  role:  { type: String, default: 'editor' },
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
});

module.exports = mongoose.model('Space', spaceSchema);
