const User = require('../models/User');

// F14: check both session role AND DB role so revocations take effect immediately.
module.exports = async function requireAdmin(req, res, next) {
  if (!req.session?.userId || req.session?.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const user = await User.findOne({ id: req.session.userId }).select('role -_id').lean();
    if (!user || user.role !== 'superadmin') {
      req.session.userRole = user?.role || 'user';
      return res.status(403).json({ error: 'Forbidden' });
    }
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
  next();
};
