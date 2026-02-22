// src/routes/admin.js
// Round 3: soft-delete instead of hard-delete + full admin_audit_log on every action.

const express = require('express');
const router  = express.Router();
const { query } = require('../config/database');
const { requireAuth } = require('../middleware/auth');
const { adminSetQuota, getQuotaSummary } = require('../services/quotaService');
const logger = require('../utils/logger');

async function requireAdmin(req, res, next) {
  const result = await query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
  if (!result.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required.' });
  next();
}

router.use(requireAuth, requireAdmin);

// ─── Audit log helper ─────────────────────────────────────────────────────────

async function audit(adminId, targetUserId, action, detail = {}, req) {
  const ip = req?.ip || req?.headers?.['x-forwarded-for'] || null;
  await query(
    `INSERT INTO admin_audit_log (admin_id, target_user_id, action, detail, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, targetUserId, action, JSON.stringify(detail), ip]
  ).catch(err => logger.warn('Failed to write audit log', { error: err.message }));
}

// ─── GET /admin/users ─────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { search, limit = 200, offset = 0 } = req.query;
  try {
    let sql = `
      SELECT
        u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin, u.deleted_at,
        s.plan, s.status AS subscription_status, s.current_period_end,
        q.lifetime_allowance, q.lifetime_used, q.daily_allowance, q.daily_used,
        (SELECT COUNT(*) FROM scans sc WHERE sc.user_id = u.id AND sc.status = 'complete') AS scan_count,
        (SELECT COUNT(*) FROM cleanup_actions ca WHERE ca.user_id = u.id AND ca.status = 'complete') AS cleanup_count,
        (SELECT SUM(bytes_freed) FROM cleanup_actions ca WHERE ca.user_id = u.id AND ca.status = 'complete') AS total_bytes_freed,
        (SELECT ca2.executed_at  FROM cleanup_actions ca2 WHERE ca2.user_id = u.id AND ca2.status = 'complete' ORDER BY ca2.executed_at DESC LIMIT 1) AS last_action_at,
        (SELECT ca2.category     FROM cleanup_actions ca2 WHERE ca2.user_id = u.id AND ca2.status = 'complete' ORDER BY ca2.executed_at DESC LIMIT 1) AS last_action_category,
        (SELECT ca2.message_count FROM cleanup_actions ca2 WHERE ca2.user_id = u.id AND ca2.status = 'complete' ORDER BY ca2.executed_at DESC LIMIT 1) AS last_action_count,
        (SELECT sc2.completed_at FROM scans sc2 WHERE sc2.user_id = u.id AND sc2.status = 'complete' ORDER BY sc2.completed_at DESC LIMIT 1) AS last_scan_at
      FROM users u
      LEFT JOIN subscription_status s ON s.user_id = u.id
      LEFT JOIN user_quota q ON q.user_id = u.id
      WHERE u.deleted_at IS NULL
    `;
    const params = [];
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      sql += ` AND (LOWER(u.email) LIKE $${params.length} OR LOWER(u.display_name) LIKE $${params.length})`;
    }
    sql += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await query(sql, params);

    let countSql = 'SELECT COUNT(*) FROM users u WHERE u.deleted_at IS NULL';
    const countParams = [];
    if (search) {
      countParams.push(`%${search.toLowerCase()}%`);
      countSql += ` AND (LOWER(u.email) LIKE $1 OR LOWER(u.display_name) LIKE $1)`;
    }
    const countResult = await query(countSql, countParams);

    return res.json({
      users: result.rows.map(row => ({
        id: row.id, email: row.email, displayName: row.display_name,
        avatarUrl: row.avatar_url, joinedAt: row.created_at, isAdmin: row.is_admin,
        subscription: {
          plan: row.plan || 'free', status: row.subscription_status || 'active',
          isPro: row.plan === 'pro' && row.subscription_status === 'active',
          currentPeriodEnd: row.current_period_end,
        },
        quota: {
          lifetimeAllowance: row.lifetime_allowance ?? 500, lifetimeUsed: row.lifetime_used ?? 0,
          dailyAllowance: row.daily_allowance ?? 50, dailyUsed: row.daily_used ?? 0,
        },
        stats: {
          scanCount: parseInt(row.scan_count) || 0,
          cleanupCount: parseInt(row.cleanup_count) || 0,
          totalBytesFreed: parseInt(row.total_bytes_freed) || 0,
        },
        lastAction: row.last_action_at ? {
          executedAt: row.last_action_at, category: row.last_action_category,
          messageCount: parseInt(row.last_action_count) || 0,
        } : null,
        lastScanAt: row.last_scan_at || null,
      })),
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit), offset: parseInt(offset),
    });
  } catch (err) {
    logger.error('Admin: failed to list users', err);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ─── GET /admin/users/:userId ─────────────────────────────────────────────────

router.get('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin, u.deleted_at,
              s.plan, s.status AS subscription_status, s.current_period_end, s.stripe_subscription_id
       FROM users u LEFT JOIN subscription_status s ON s.user_id = u.id
       WHERE u.id = $1`, [userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    const quota = await getQuotaSummary(userId);
    const row = result.rows[0];
    return res.json({
      id: row.id, email: row.email, displayName: row.display_name,
      avatarUrl: row.avatar_url, joinedAt: row.created_at, isAdmin: row.is_admin,
      deletedAt: row.deleted_at,
      subscription: {
        plan: row.plan || 'free', status: row.subscription_status || 'active',
        isPro: row.plan === 'pro' && row.subscription_status === 'active',
        currentPeriodEnd: row.current_period_end, subscriptionId: row.stripe_subscription_id,
      },
      quota,
    });
  } catch (err) {
    logger.error('Admin: failed to get user', err, { userId });
    return res.status(500).json({ error: 'Failed to fetch user.' });
  }
});

// ─── PATCH /admin/users/:userId/role ─────────────────────────────────────────

router.patch('/users/:userId/role', async (req, res) => {
  const { userId } = req.params;
  const { isAdmin } = req.body;
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot change your own admin status.' });
  if (typeof isAdmin !== 'boolean') return res.status(400).json({ error: 'isAdmin must be true or false.' });
  try {
    const prev = await query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    await query('UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2', [isAdmin, userId]);
    await audit(req.user.id, userId, isAdmin ? 'make_admin' : 'remove_admin',
      { before: prev.rows[0]?.is_admin, after: isAdmin }, req);
    logger.info('Admin: role updated', { adminId: req.user.id, targetUserId: userId, isAdmin });
    return res.json({ success: true, isAdmin });
  } catch (err) {
    logger.error('Admin: failed to update role', err, { userId });
    return res.status(500).json({ error: 'Failed to update role.' });
  }
});

// ─── PATCH /admin/users/:userId/subscription ─────────────────────────────────

router.patch('/users/:userId/subscription', async (req, res) => {
  const { userId } = req.params;
  const { plan, status } = req.body;
  const validPlans    = ['free', 'pro'];
  const validStatuses = ['active', 'canceled', 'past_due'];
  if (!validPlans.includes(plan)) return res.status(400).json({ error: `Plan must be: ${validPlans.join(', ')}` });
  if (status && !validStatuses.includes(status)) return res.status(400).json({ error: `Status must be: ${validStatuses.join(', ')}` });
  try {
    const prev = await query('SELECT plan, status FROM subscription_status WHERE user_id = $1', [userId]);
    const currentPeriodEnd = plan === 'pro' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
    await query(
      `INSERT INTO subscription_status (user_id, plan, status, current_period_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET plan = $2, status = $3, current_period_end = $4, updated_at = NOW()`,
      [userId, plan, status || 'active', currentPeriodEnd]
    );
    await audit(req.user.id, userId, plan === 'pro' ? 'grant_pro' : 'remove_pro',
      { before: prev.rows[0], after: { plan, status: status || 'active' } }, req);
    logger.info('Admin: subscription updated', { adminId: req.user.id, targetUserId: userId, plan });
    return res.json({ success: true, plan, status: status || 'active', currentPeriodEnd });
  } catch (err) {
    logger.error('Admin: failed to update subscription', err, { userId });
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }
});

// ─── PATCH /admin/users/:userId/quota ────────────────────────────────────────

router.patch('/users/:userId/quota', async (req, res) => {
  const { userId } = req.params;
  const { lifetimeAllowance = 500, lifetimeUsed = 0, dailyAllowance = 50 } = req.body;
  try {
    await adminSetQuota(userId, { lifetimeAllowance, lifetimeUsed, dailyAllowance });
    await audit(req.user.id, userId, 'reset_quota',
      { lifetimeAllowance, lifetimeUsed, dailyAllowance }, req);
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to update quota', err, { userId });
    return res.status(500).json({ error: 'Failed to update quota.' });
  }
});

// ─── DELETE /admin/users/:userId ──────────────────────────────────────────────
// SOFT DELETE: sets deleted_at, does NOT physically remove rows.
// A cron task (in worker.js) hard-deletes records after 30 days.

router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;
  if (userId === req.user.id) return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  try {
    const userResult = await query('SELECT email, display_name FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found.' });

    await query('UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [userId]);
    await audit(req.user.id, userId, 'delete_user',
      { email: userResult.rows[0].email, displayName: userResult.rows[0].display_name,
        deletedAt: new Date().toISOString(), note: 'Soft delete — hard delete after 30 days' }, req);

    logger.info('Admin: user soft-deleted', { adminId: req.user.id, deletedUserId: userId });
    return res.json({ success: true, message: 'User soft-deleted. Data will be permanently removed after 30 days.' });
  } catch (err) {
    logger.error('Admin: failed to delete user', err, { userId });
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ─── POST /admin/users/:userId/restore ───────────────────────────────────────
// Restore a soft-deleted user within the 30-day window.

router.post('/users/:userId/restore', async (req, res) => {
  const { userId } = req.params;
  try {
    const result = await query(
      `UPDATE users SET deleted_at = NULL, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NOT NULL RETURNING email`,
      [userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found or not deleted.' });
    await audit(req.user.id, userId, 'restore_user', { restoredAt: new Date().toISOString() }, req);
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to restore user', err, { userId });
    return res.status(500).json({ error: 'Failed to restore user.' });
  }
});

// ─── GET /admin/audit-log ─────────────────────────────────────────────────────

router.get('/audit-log', async (req, res) => {
  const { limit = 50, offset = 0, targetUserId } = req.query;
  try {
    let sql = `
      SELECT al.id, al.action, al.detail, al.ip_address, al.created_at,
             a.email AS admin_email, t.email AS target_email
      FROM admin_audit_log al
      LEFT JOIN users a ON a.id = al.admin_id
      LEFT JOIN users t ON t.id = al.target_user_id
    `;
    const params = [];
    if (targetUserId) {
      params.push(targetUserId);
      sql += ` WHERE al.target_user_id = $${params.length}`;
    }
    sql += ` ORDER BY al.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await query(sql, params);
    return res.json({ log: result.rows });
  } catch (err) {
    logger.error('Admin: failed to fetch audit log', err);
    return res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const [users, proUsers, scans, cleanups, recentSignups, softDeleted] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
      query("SELECT COUNT(*) FROM subscription_status WHERE plan = 'pro' AND status = 'active'"),
      query("SELECT COUNT(*) FROM scans WHERE status = 'complete'"),
      query("SELECT COUNT(*), COALESCE(SUM(bytes_freed), 0) AS total_bytes FROM cleanup_actions WHERE status = 'complete'"),
      query("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days' AND deleted_at IS NULL"),
      query("SELECT COUNT(*) FROM users WHERE deleted_at IS NOT NULL"),
    ]);
    return res.json({
      totalUsers:        parseInt(users.rows[0].count),
      proUsers:          parseInt(proUsers.rows[0].count),
      totalScans:        parseInt(scans.rows[0].count),
      totalCleanups:     parseInt(cleanups.rows[0].count),
      totalBytesFreed:   parseInt(cleanups.rows[0].total_bytes),
      newUsersThisWeek:  parseInt(recentSignups.rows[0].count),
      softDeletedUsers:  parseInt(softDeleted.rows[0].count),
    });
  } catch (err) {
    logger.error('Admin: failed to fetch stats', err);
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;
