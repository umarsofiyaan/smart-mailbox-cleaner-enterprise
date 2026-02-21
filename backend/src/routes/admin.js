// src/routes/admin.js
// Admin-only endpoints for managing users and subscriptions.
// Protected by requireAuth + requireAdmin middleware.
// Access via: /admin/*

const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { adminSetQuota, getQuotaSummary } = require('../services/quotaService');
const logger = require('../utils/logger');

/**
 * Middleware: only allow users with is_admin = true
 */
async function requireAdmin(req, res, next) {
  const result = await query(
    'SELECT is_admin FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!result.rows[0]?.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// All admin routes require auth + admin
router.use(requireAuth, requireAdmin);

/**
 * GET /admin/users
 * List all users with subscription + quota info.
 * Supports ?search=email query param.
 */
router.get('/users', async (req, res) => {
  const { search, limit = 50, offset = 0 } = req.query;

  try {
    let sql = `
      SELECT
        u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin,
        s.plan, s.status AS subscription_status, s.current_period_end,
        q.lifetime_allowance, q.lifetime_used, q.daily_allowance, q.daily_used,
        q.daily_quota_granted_at,
        (SELECT COUNT(*) FROM scans sc WHERE sc.user_id = u.id AND sc.status = 'complete') AS scan_count,
        (SELECT COUNT(*) FROM cleanup_actions ca WHERE ca.user_id = u.id AND ca.status = 'complete') AS cleanup_count
      FROM users u
      LEFT JOIN subscription_status s ON s.user_id = u.id
      LEFT JOIN user_quota q ON q.user_id = u.id
    `;

    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      sql += ` WHERE LOWER(u.email) LIKE $${params.length} OR LOWER(u.display_name) LIKE $${params.length}`;
    }

    sql += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(sql, params);

    // Count total
    let countSql = 'SELECT COUNT(*) FROM users u';
    const countParams = [];
    if (search) {
      countParams.push(`%${search.toLowerCase()}%`);
      countSql += ` WHERE LOWER(u.email) LIKE $1 OR LOWER(u.display_name) LIKE $1`;
    }
    const countResult = await query(countSql, countParams);

    return res.json({
      users: result.rows.map(row => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        joinedAt: row.created_at,
        isAdmin: row.is_admin,
        subscription: {
          plan: row.plan || 'free',
          status: row.subscription_status || 'active',
          isPro: row.plan === 'pro' && row.subscription_status === 'active',
          currentPeriodEnd: row.current_period_end,
        },
        quota: {
          lifetimeAllowance: row.lifetime_allowance ?? 500,
          lifetimeUsed: row.lifetime_used ?? 0,
          dailyAllowance: row.daily_allowance ?? 50,
          dailyUsed: row.daily_used ?? 0,
          dailyGrantedAt: row.daily_quota_granted_at,
        },
        stats: {
          scanCount: parseInt(row.scan_count) || 0,
          cleanupCount: parseInt(row.cleanup_count) || 0,
        },
      })),
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    logger.error('Admin: failed to list users', err);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

/**
 * GET /admin/users/:userId
 * Get a single user's full detail.
 */
router.get('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin,
              s.plan, s.status AS subscription_status, s.current_period_end, s.stripe_subscription_id
       FROM users u
       LEFT JOIN subscription_status s ON s.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const quota = await getQuotaSummary(userId);
    const row = result.rows[0];

    return res.json({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      joinedAt: row.created_at,
      isAdmin: row.is_admin,
      subscription: {
        plan: row.plan || 'free',
        status: row.subscription_status || 'active',
        isPro: row.plan === 'pro' && row.subscription_status === 'active',
        currentPeriodEnd: row.current_period_end,
        subscriptionId: row.stripe_subscription_id,
      },
      quota,
    });
  } catch (err) {
    logger.error('Admin: failed to get user', err, { userId });
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

/**
 * PATCH /admin/users/:userId/subscription
 * Manually set a user's subscription plan.
 * Body: { plan: 'pro' | 'free', status: 'active' | 'canceled' }
 */
router.patch('/users/:userId/subscription', async (req, res) => {
  const { userId } = req.params;
  const { plan, status } = req.body;

  const validPlans = ['free', 'pro'];
  const validStatuses = ['active', 'canceled', 'past_due'];

  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: `Plan must be one of: ${validPlans.join(', ')}` });
  }
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const currentPeriodEnd = plan === 'pro'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days for manual pro
      : null;

    await query(
      `INSERT INTO subscription_status (user_id, plan, status, current_period_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE
       SET plan = $2, status = $3, current_period_end = $4, updated_at = NOW()`,
      [userId, plan, status || 'active', currentPeriodEnd]
    );

    logger.info('Admin: subscription updated', {
      adminId: req.user.id,
      targetUserId: userId,
      plan,
      status,
    });

    return res.json({ success: true, plan, status: status || 'active', currentPeriodEnd });
  } catch (err) {
    logger.error('Admin: failed to update subscription', err, { userId });
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }
});

/**
 * PATCH /admin/users/:userId/quota
 * Manually adjust a user's quota.
 * Body: { lifetimeAllowance, lifetimeUsed, dailyAllowance }
 */
router.patch('/users/:userId/quota', async (req, res) => {
  const { userId } = req.params;
  const { lifetimeAllowance = 500, lifetimeUsed = 0, dailyAllowance = 50 } = req.body;

  try {
    await adminSetQuota(userId, { lifetimeAllowance, lifetimeUsed, dailyAllowance });

    logger.info('Admin: quota updated', {
      adminId: req.user.id,
      targetUserId: userId,
      lifetimeAllowance,
      lifetimeUsed,
      dailyAllowance,
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to update quota', err, { userId });
    return res.status(500).json({ error: 'Failed to update quota.' });
  }
});

/**
 * DELETE /admin/users/:userId
 * Delete a user account and all their data.
 */
router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }

  try {
    await query('DELETE FROM users WHERE id = $1', [userId]);

    logger.info('Admin: user deleted', { adminId: req.user.id, deletedUserId: userId });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to delete user', err, { userId });
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

/**
 * GET /admin/stats
 * Dashboard-level stats for admin overview.
 */
router.get('/stats', async (req, res) => {
  try {
    const [users, proUsers, scans, cleanups] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query("SELECT COUNT(*) FROM subscription_status WHERE plan = 'pro' AND status = 'active'"),
      query("SELECT COUNT(*) FROM scans WHERE status = 'complete'"),
      query("SELECT COUNT(*), COALESCE(SUM(bytes_freed), 0) AS total_bytes FROM cleanup_actions WHERE status = 'complete'"),
    ]);

    return res.json({
      totalUsers: parseInt(users.rows[0].count),
      proUsers: parseInt(proUsers.rows[0].count),
      totalScans: parseInt(scans.rows[0].count),
      totalCleanups: parseInt(cleanups.rows[0].count),
      totalBytesFreed: parseInt(cleanups.rows[0].total_bytes),
    });
  } catch (err) {
    logger.error('Admin: failed to fetch stats', err);
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;
