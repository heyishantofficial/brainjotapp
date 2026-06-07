const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  code: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // TTL index: automatic deletion after 5 minutes (300 seconds)
});

module.exports = mongoose.model('Otp', otpSchema);
