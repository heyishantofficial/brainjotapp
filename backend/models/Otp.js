const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  codeHash:   { type: String, required: true },   // HMAC-SHA256 of the 6-digit code — never store plaintext
  expiresAt:  { type: Date, required: true },
  attempts:   { type: Number, default: 0 },       // incremented on each wrong guess; OTP killed at 5
  lastSentAt: { type: Date, default: Date.now },  // used to enforce 60-second resend cooldown
  createdAt:  { type: Date, default: Date.now, expires: 300 }, // TTL: auto-delete 5 min after creation
});

module.exports = mongoose.model('Otp', otpSchema);
