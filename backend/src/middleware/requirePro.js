// src/middleware/requirePro.js
// DEV MODE: Pro paywall bypassed for testing
// ⚠️ Remove this before going to production!

async function requirePro(req, res, next) {
  if (process.env.BYPASS_PRO === 'true') {
    req.subscription = { plan: 'pro', status: 'active' };
    return next();
  }

  // Original check (restore this for production)
  const { query } = require('../config/database');
  const result = await query(
    `SELECT plan, status, current_period_end FROM subscription_status WHERE user_id = $1`,
    [req.user.id]
  );
  const sub = result.rows[0];
  if (!sub || sub.plan !== 'pro' || sub.status !== 'active') {
    return res.status(403).json({
      error: 'Pro subscription required.',
      code: 'PRO_REQUIRED',
    });
  }
  req.subscription = sub;
  next();
}

module.exports = { requirePro };
