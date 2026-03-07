// src/services/quotaService.js
// Credit-based deletion quota + plan management.

const { query, getClient } = require('../config/database');
const logger = require('../utils/logger');

const FREE_CREDITS = 1000;
const STARTER_CREDITS = 10000;
const PRO_CREDITS = 50000;

function isPowerActiveFromRow(row) {
  if (!row) return false;
  if (row.plan_type !== 'power') return false;
  if (!row.plan_expiry) return false;
  return new Date(row.plan_expiry) > new Date();
}

async function ensureUserQuotaState(userId) {
  await query(
    `UPDATE users
     SET delete_credits = COALESCE(delete_credits, $2),
         free_plan_used = COALESCE(free_plan_used, FALSE),
         plan_type = COALESCE(plan_type, 'free'),
         emails_deleted_total = COALESCE(emails_deleted_total, 0),
         storage_recovered_mb = COALESCE(storage_recovered_mb, 0),
         updated_at = NOW()
     WHERE id = $1`,
    [userId, FREE_CREDITS]
  );

  const result = await query(
    `SELECT id, delete_credits, free_plan_used, plan_type, plan_expiry, emails_deleted_total, storage_recovered_mb
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] || null;
}

async function getQuota(userId) {
  const state = await ensureUserQuotaState(userId);
  if (!state) {
    return {
      deleteCredits: 0,
      freePlanUsed: false,
      planType: 'free',
      planExpiry: null,
      emailsDeletedTotal: 0,
      storageRecoveredMb: 0,
      isPowerActive: false,
    };
  }

  return {
    deleteCredits: Math.max(0, Number(state.delete_credits || 0)),
    freePlanUsed: !!state.free_plan_used,
    planType: state.plan_type || 'free',
    planExpiry: state.plan_expiry || null,
    emailsDeletedTotal: Number(state.emails_deleted_total || 0),
    storageRecoveredMb: Number(state.storage_recovered_mb || 0),
    isPowerActive: isPowerActiveFromRow(state),
  };
}

async function grantDailyQuotaOnLogin(userId) {
  // Backward-compatible hook for existing auth flow.
  await ensureUserQuotaState(userId);
}

async function checkQuota(userId, requestedDeleteCount = 1) {
  try {
    const state = await ensureUserQuotaState(userId);
    if (!state) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'Account not found.',
        code: 'PAYWALL_REQUIRED',
        planType: 'free',
        planExpiry: null,
      };
    }

    const normalizedRequested = Math.max(1, Number(requestedDeleteCount) || 1);

    if (isPowerActiveFromRow(state)) {
      return {
        allowed: true,
        remaining: Infinity,
        reason: 'Power plan active - unlimited cleanup',
        code: 'OK',
        planType: 'power',
        planExpiry: state.plan_expiry,
      };
    }

    const credits = Math.max(0, Number(state.delete_credits || 0));
    if (credits >= normalizedRequested) {
      return {
        allowed: true,
        remaining: credits,
        reason: `${credits} credits available`,
        code: 'OK',
        planType: state.plan_type || 'free',
        planExpiry: state.plan_expiry,
      };
    }

    return {
      allowed: false,
      remaining: credits,
      reason: 'PAYWALL_REQUIRED',
      code: 'PAYWALL_REQUIRED',
      planType: state.plan_type || 'free',
      planExpiry: state.plan_expiry,
    };
  } catch (err) {
    logger.error('Failed to check quota', err, { userId, requestedDeleteCount });
    return {
      allowed: false,
      remaining: 0,
      reason: 'PAYWALL_REQUIRED',
      code: 'PAYWALL_REQUIRED',
      planType: 'free',
      planExpiry: null,
    };
  }
}

async function consumeQuota(userId, emailCount) {
  const count = Math.max(0, Number(emailCount) || 0);
  if (count <= 0) return;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT delete_credits, free_plan_used, plan_type, plan_expiry, emails_deleted_total, storage_recovered_mb
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return;
    }

    const row = result.rows[0];
    const isPower = isPowerActiveFromRow(row);
    const currentCredits = Math.max(0, Number(row.delete_credits || 0));
    const nextCredits = isPower ? currentCredits : Math.max(0, currentCredits - count);
    const recoveredMbInc = Math.floor((count * 75) / 1024);

    await client.query(
      `UPDATE users
       SET delete_credits = $2,
           free_plan_used = CASE WHEN $3::int > 0 THEN TRUE ELSE COALESCE(free_plan_used, FALSE) END,
           emails_deleted_total = COALESCE(emails_deleted_total, 0) + $3,
           storage_recovered_mb = COALESCE(storage_recovered_mb, 0) + $4,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, nextCredits, count, recoveredMbInc]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to consume quota', err, { userId, emailCount: count });
  } finally {
    client.release();
  }
}

async function applyPurchasedPlan(userId, planType) {
  const normalizedPlan = String(planType || '').toLowerCase();

  if (!['starter', 'pro', 'power'].includes(normalizedPlan)) {
    throw new Error('Invalid plan_type. Must be starter, pro, or power.');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE users
       SET delete_credits = COALESCE(delete_credits, $2),
           plan_type = COALESCE(plan_type, 'free'),
           emails_deleted_total = COALESCE(emails_deleted_total, 0),
           storage_recovered_mb = COALESCE(storage_recovered_mb, 0),
           free_plan_used = COALESCE(free_plan_used, FALSE),
           updated_at = NOW()
       WHERE id = $1`,
      [userId, FREE_CREDITS]
    );

    if (normalizedPlan === 'starter') {
      await client.query(
        `UPDATE users
         SET delete_credits = GREATEST(0, COALESCE(delete_credits, 0)) + $2,
             plan_type = 'starter',
             plan_expiry = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [userId, STARTER_CREDITS]
      );
    } else if (normalizedPlan === 'pro') {
      await client.query(
        `UPDATE users
         SET delete_credits = GREATEST(0, COALESCE(delete_credits, 0)) + $2,
             plan_type = 'pro',
             plan_expiry = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [userId, PRO_CREDITS]
      );
    } else {
      await client.query(
        `UPDATE users
         SET plan_type = 'power',
             plan_expiry = NOW() + INTERVAL '30 days',
             updated_at = NOW()
         WHERE id = $1`,
        [userId]
      );
    }

    await client.query('COMMIT');
    return await getQuotaSummary(userId);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to apply purchased plan', err, { userId, planType: normalizedPlan });
    throw err;
  } finally {
    client.release();
  }
}

async function getQuotaSummary(userId) {
  try {
    const result = await query(
      `SELECT delete_credits, free_plan_used, plan_type, plan_expiry, emails_deleted_total, storage_recovered_mb
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const row = result.rows[0];
    if (!row) {
      return {
        deleteCredits: 0,
        freePlanUsed: false,
        planType: 'free',
        planExpiry: null,
        isPowerActive: false,
        emailsDeletedTotal: 0,
        storageRecoveredBytes: 0,
        message: 'Quota unavailable.',
      };
    }

    const isPowerActive = isPowerActiveFromRow(row);
    const credits = Math.max(0, Number(row.delete_credits || 0));
    const emailsDeletedTotal = Number(row.emails_deleted_total || 0);
    const storageRecoveredMb = Number(row.storage_recovered_mb || 0);

    const bytesRes = await query(
      `SELECT COALESCE(SUM(bytes_freed), 0) AS total_bytes
       FROM cleanup_actions
       WHERE user_id = $1 AND status = 'complete'`,
      [userId]
    );
    const storageRecoveredBytes = Number(bytesRes.rows[0]?.total_bytes || 0);

    return {
      deleteCredits: credits,
      freePlanUsed: !!row.free_plan_used,
      planType: row.plan_type || 'free',
      planExpiry: row.plan_expiry,
      isPowerActive,
      emailsDeletedTotal,
      storageRecoveredMb,
      storageRecoveredBytes,
      message: isPowerActive
        ? `Unlimited cleanup active until ${new Date(row.plan_expiry).toISOString()}`
        : `${credits} delete credits remaining`,

      // Backward compatibility for existing frontend/admin consumers.
      isPro: isPowerActive || ['starter', 'pro'].includes(row.plan_type),
      plan: row.plan_type || 'free',
      lifetime: {
        allowance: null,
        used: emailsDeletedTotal,
        remaining: isPowerActive ? null : credits,
      },
      daily: {
        allowance: null,
        used: 0,
        remaining: null,
      },
    };
  } catch (err) {
    logger.error('Failed to get quota summary', err, { userId });
    return {
      deleteCredits: 0,
      freePlanUsed: false,
      planType: 'free',
      planExpiry: null,
      isPowerActive: false,
      emailsDeletedTotal: 0,
      storageRecoveredBytes: 0,
      message: 'Failed to fetch quota.',
    };
  }
}

async function adminSetQuota(userId, { lifetimeAllowance = FREE_CREDITS, lifetimeUsed = 0 }) {
  const allowance = Math.max(0, Number(lifetimeAllowance) || FREE_CREDITS);
  const used = Math.max(0, Number(lifetimeUsed) || 0);
  const credits = Math.max(0, allowance - used);

  await query(
    `UPDATE users
     SET delete_credits = $2,
         free_plan_used = CASE WHEN $3 > 0 THEN TRUE ELSE COALESCE(free_plan_used, FALSE) END,
         updated_at = NOW()
     WHERE id = $1`,
    [userId, credits, used]
  );
}

module.exports = {
  FREE_CREDITS,
  STARTER_CREDITS,
  PRO_CREDITS,
  getQuota,
  grantDailyQuotaOnLogin,
  checkQuota,
  consumeQuota,
  applyPurchasedPlan,
  getQuotaSummary,
  adminSetQuota,
};
