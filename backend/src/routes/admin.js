// src/routes/admin.js
// Admin-only endpoints for managing users and subscriptions.
// Protected by requireAuth + requireAdmin middleware.

const express = require('express');
const router  = express.Router();
const { query }          = require('../config/database');
const { requireAuth }    = require('../middleware/auth');
const { adminSetQuota, applyPurchasedPlan } = require('../services/quotaService');
const { revokeAllTokens, deleteUserTokens } = require('../services/tokenService');
const logger = require('../utils/logger');

// ─── Middleware ───────────────────────────────────────────────────────────────

async function requireAdmin(req, res, next) {
  const result = await query(
    'SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL',
    [req.user.id]
  );
  if (!result.rows[0]?.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

router.use(requireAuth, requireAdmin);

// ─── Audit log helper ────────────────────────────────────────────────────────

async function writeAudit(adminId, adminEmail, action, targetUserId, targetEmail, details = {}) {
  try {
    await query(
      `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_user_id, target_email, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, adminEmail || null, action, targetUserId || null, targetEmail || null, JSON.stringify(details)]
    );
  } catch (err) {
    logger.warn('Failed to write audit log', { err: err.message, action, targetUserId });
  }
}

// ─── GET /admin/users ─────────────────────────────────────────────────────────

router.get('/users', async (req, res) => {
  const { search, limit = 50, offset = 0, includeDeleted = 'false' } = req.query;

  try {
    const params  = [];
    const clauses = [];

    if (includeDeleted !== 'true') {
      clauses.push('u.deleted_at IS NULL');
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      clauses.push(
        `(LOWER(u.email) LIKE $${params.length} OR LOWER(u.display_name) LIKE $${params.length})`
      );
    }

    const whereClause = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

    // Separate count query using same alias/joins so WHERE clause works correctly
    const countSql = `
      SELECT COUNT(*) FROM users u
      LEFT JOIN subscription_status s ON s.user_id = u.id
      LEFT JOIN user_quota          q ON q.user_id  = u.id
      ${whereClause}
    `;

    const dataSql = `
      SELECT
        u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin,
        u.deleted_at, u.deleted_by,
        u.plan_type, u.plan_expiry, u.delete_credits, u.emails_deleted_total, u.storage_recovered_mb,
        CASE WHEN u.plan_type = 'power' AND u.plan_expiry > NOW() THEN TRUE ELSE FALSE END AS is_power_active,
        COALESCE(NULLIF(u.plan_type, 'free'), s.plan, 'free') AS plan,
        CASE
          WHEN u.plan_type IN ('starter', 'pro', 'power') THEN 'active'
          ELSE COALESCE(s.status, 'active')
        END AS subscription_status,
        COALESCE(u.plan_expiry, s.current_period_end) AS current_period_end,
        q.lifetime_allowance, q.lifetime_used, q.daily_allowance, q.daily_used,
        q.daily_quota_granted_at,
        (SELECT COUNT(*) FROM scans sc WHERE sc.user_id = u.id AND sc.status = 'complete') AS scan_count,
        (SELECT COUNT(*) FROM cleanup_actions cj WHERE cj.user_id = u.id AND cj.status = 'complete') AS cleanup_count
      FROM users u
      LEFT JOIN subscription_status s ON s.user_id = u.id
      LEFT JOIN user_quota          q ON q.user_id  = u.id
      ${whereClause}
      ORDER BY u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const dataParams = [...params, parseInt(limit), parseInt(offset)];

    const [rows, countResult] = await Promise.all([
      query(dataSql, dataParams),
      query(countSql, params),
    ]);

    return res.json({
      users:  rows.rows,
      total:  parseInt(countResult.rows[0].count),
      limit:  parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    logger.error('Admin: failed to list users', err);
    return res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// ─── PATCH /admin/users/:userId/role ─────────────────────────────────────────

router.patch('/users/:userId/role', async (req, res) => {
  const { userId }  = req.params;
  const { isAdmin } = req.body;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own admin status.' });
  }
  if (typeof isAdmin !== 'boolean') {
    return res.status(400).json({ error: 'isAdmin must be true or false.' });
  }

  try {
    const target = await query('SELECT email FROM users WHERE id = $1', [userId]);
    await query(
      'UPDATE users SET is_admin = $1, updated_at = NOW() WHERE id = $2',
      [isAdmin, userId]
    );
    await writeAudit(req.user.id, req.user.email, 'set_role', userId, target.rows[0]?.email, { isAdmin });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to update role', err, { userId });
    return res.status(500).json({ error: 'Failed to update role.' });
  }
});

// ─── PATCH /admin/users/:userId/subscription ─────────────────────────────────

router.patch('/users/:userId/subscription', async (req, res) => {
  const { userId }        = req.params;
  const { plan, status }  = req.body;

  const validPlans    = ['free', 'starter', 'pro', 'power'];
  const validStatuses = ['active', 'canceled', 'past_due'];

  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: `Plan must be one of: ${validPlans.join(', ')}` });
  }
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
  }

  try {
    const target = await query('SELECT email FROM users WHERE id = $1', [userId]);

    if (plan === 'free') {
      // ── Admin override: immediate downgrade in DB (provider-agnostic) ────
      // We intentionally avoid depending on Razorpay APIs from admin actions,
      // so dashboard controls always work as a manual override layer.
      await query(
        `INSERT INTO subscription_status (user_id, plan, status, current_period_end)
         VALUES ($1, 'free', $2, NULL)
         ON CONFLICT (user_id) DO UPDATE
         SET plan = 'free', status = $2, current_period_end = NULL, updated_at = NOW()`,
        [userId, status || 'canceled']
      );
      await query(
        `UPDATE users
         SET plan_type = 'free',
             plan_expiry = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    } else {
      // ── Grant paid plan manually (no provider subscription required) ─────
      await applyPurchasedPlan(userId, plan);
      const currentPeriodEnd = plan === 'power'
        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        : null;
      await query(
        `INSERT INTO subscription_status (user_id, plan, status, current_period_end)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE
         SET plan = $2, status = $3, current_period_end = $4, updated_at = NOW()`,
        [userId, plan, status || 'active', currentPeriodEnd]
      );
    }

    await writeAudit(req.user.id, req.user.email, 'set_subscription', userId, target.rows[0]?.email, { plan, status });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to update subscription', err, { userId });
    return res.status(500).json({ error: 'Failed to update subscription.' });
  }
});

// ─── PATCH /admin/users/:userId/quota ────────────────────────────────────────

router.patch('/users/:userId/quota', async (req, res) => {
  const { userId } = req.params;
  const { deleteCredits, lifetimeAllowance = 1000, lifetimeUsed = 0, dailyAllowance = 0 } = req.body;

  try {
    const target = await query('SELECT email FROM users WHERE id = $1', [userId]);
    if (deleteCredits !== undefined && deleteCredits !== null) {
      const credits = Math.max(0, Number(deleteCredits) || 0);
      await query(
        `UPDATE users
         SET delete_credits = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [userId, credits]
      );
      await writeAudit(req.user.id, req.user.email, 'set_quota', userId, target.rows[0]?.email, { deleteCredits: credits });
    } else {
      // Backward-compatible fallback.
      await adminSetQuota(userId, { lifetimeAllowance, lifetimeUsed, dailyAllowance });
      await writeAudit(req.user.id, req.user.email, 'set_quota', userId, target.rows[0]?.email, { lifetimeAllowance, lifetimeUsed, dailyAllowance });
    }
    return res.json({ success: true });
  } catch (err) {
    logger.error('Admin: failed to update quota', err, { userId });
    return res.status(500).json({ error: 'Failed to update quota.' });
  }
});

// ─── DELETE /admin/users/:userId ──────────────────────────────────────────────

router.delete('/users/:userId', async (req, res) => {
  const { userId } = req.params;

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account.' });
  }

  try {
    const target = await query('SELECT email FROM users WHERE id = $1', [userId]);

    // 1. Revoke ALL JWT refresh tokens → next token refresh fails immediately
    await revokeAllTokens(userId);

    // 2. Soft-delete: keeps data for audit trail; requireAuth rejects deleted_at IS NOT NULL
    const result = await query(
      `UPDATE users
       SET deleted_at = NOW(), deleted_by = $2, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [userId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or already deleted.' });
    }

    await writeAudit(req.user.id, req.user.email, 'delete_user', userId, target.rows[0]?.email, { soft: true });
    logger.info('Admin: user soft-deleted, all tokens revoked', { adminId: req.user.id, deletedUserId: userId });

    return res.json({ success: true, message: 'User deleted and all active sessions revoked.' });
  } catch (err) {
    logger.error('Admin: failed to delete user', err, { userId });
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ─── PATCH /admin/users/:userId/restore ──────────────────────────────────────

router.patch('/users/:userId/restore', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await query(
      `UPDATE users
       SET deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NOT NULL
       RETURNING id, email`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or not deleted.' });
    }

    await writeAudit(req.user.id, req.user.email, 'restore_user', userId, result.rows[0].email, {});
    logger.info('Admin: user restored', { adminId: req.user.id, restoredUserId: userId });
    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    logger.error('Admin: failed to restore user', err, { userId });
    return res.status(500).json({ error: 'Failed to restore user.' });
  }
});

// ─── GET /admin/audit ─────────────────────────────────────────────────────────

router.get('/audit', async (req, res) => {
  const { limit = 50, offset = 0 } = req.query;

  try {
    const result = await query(
      `SELECT al.id, al.action, al.details AS detail, al.created_at,
              al.admin_email, al.target_email,
              al.ip_address
       FROM admin_audit_log al
       ORDER BY al.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );
    return res.json({ log: result.rows });
  } catch (err) {
    logger.error('Admin: failed to fetch audit log', err);
    return res.status(500).json({ error: 'Failed to fetch audit log.' });
  }
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  try {
    const [users, proUsers, scans, cleanups, newUsers] = await Promise.all([
      query('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL'),
      query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND (plan_type IN ('starter', 'pro') OR (plan_type = 'power' AND plan_expiry > NOW()))"),
      query("SELECT COUNT(*) FROM scans WHERE status = 'complete'"),
      query("SELECT COUNT(*), COALESCE(SUM(bytes_freed),0) AS total_bytes FROM cleanup_actions WHERE status = 'complete'"),
      query("SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '7 days'"),
    ]);

    return res.json({
      totalUsers:        parseInt(users.rows[0].count),
      proUsers:          parseInt(proUsers.rows[0].count),
      totalScans:        parseInt(scans.rows[0].count),
      totalCleanups:     parseInt(cleanups.rows[0].count),
      totalBytesFreed:   parseInt(cleanups.rows[0].total_bytes),
      newUsersThisWeek:  parseInt(newUsers.rows[0].count),
    });
  } catch (err) {
    logger.error('Admin: failed to fetch stats', err);
    return res.status(500).json({ error: 'Failed to fetch stats.' });
  }
});

module.exports = router;
