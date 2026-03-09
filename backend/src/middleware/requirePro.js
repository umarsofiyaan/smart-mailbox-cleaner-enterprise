// src/middleware/requirePro.js
async function requirePro(req, res, next) {
  const { query } = require('../config/database');
  const result = await query(
    `SELECT plan_type, plan_expiry FROM users WHERE id = $1`,
    [req.user.id]
  );
  const sub = result.rows[0] || {};
  const isPowerActive = sub.plan_type === 'power' && sub.plan_expiry && new Date(sub.plan_expiry) > new Date();
  const isPaidPlan = isPowerActive || sub.plan_type === 'starter' || sub.plan_type === 'pro';

  if (!isPaidPlan) {
    return res.status(403).json({
      error: 'Pro subscription required.',
      code: 'PRO_REQUIRED',
    });
  }
  req.subscription = sub;
  next();
}

module.exports = { requirePro };
