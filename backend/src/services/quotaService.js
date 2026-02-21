// src/services/quotaService.js
// Free-tier quota enforcement: lifetime (500 emails) + daily (50/day after exhaustion)
// Pro users bypass all quota checks.
// Daily grant happens on login only (grantDailyQuotaOnLogin).

const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Get or create quota record for a user.
 * Returns { lifetimeAllowance, lifetimeUsed, dailyAllowance, dailyUsed, dailyGrantedAt }
 */
async function getQuota(userId) {
  try {
    let result = await query(
      'SELECT * FROM user_quota WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      return {
        lifetimeAllowance: result.rows[0].lifetime_allowance,
        lifetimeUsed: result.rows[0].lifetime_used,
        dailyAllowance: result.rows[0].daily_allowance,
        dailyUsed: result.rows[0].daily_used,
        dailyGrantedAt: result.rows[0].daily_quota_granted_at,
        dailyResetAt: result.rows[0].daily_reset_at,
      };
    }

    // Create new record if doesn't exist
    const now = new Date();
    const nextMidnightUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);

    const created = await query(
      `INSERT INTO user_quota (
        user_id, lifetime_allowance, lifetime_used, 
        daily_allowance, daily_used, daily_quota_granted_at, daily_reset_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [userId, 500, 0, 50, 0, null, nextMidnightUTC]
    );

    const row = created.rows[0];
    return {
      lifetimeAllowance: row.lifetime_allowance,
      lifetimeUsed: row.lifetime_used,
      dailyAllowance: row.daily_allowance,
      dailyUsed: row.daily_used,
      dailyGrantedAt: row.daily_quota_granted_at,
      dailyResetAt: row.daily_reset_at,
    };
  } catch (err) {
    logger.error('Failed to get or create quota', err, { userId });
    throw err;
  }
}

/**
 * Grant daily quota on login (50 emails).
 * Only grants if:
 * 1. User is NOT Pro
 * 2. Lifetime quota is exhausted (lifetime_used >= lifetime_allowance)
 * 3. Today is a new day (daily_quota_granted_at is in the past)
 *
 * SAFE TO CALL MULTIPLE TIMES PER LOGIN.
 */
async function grantDailyQuotaOnLogin(userId) {
  try {
    const subResult = await query(
      "SELECT plan, status FROM subscription_status WHERE user_id = $1",
      [userId]
    );

    const isPro = subResult.rows[0]?.plan === 'pro' && subResult.rows[0]?.status === 'active';
    if (isPro) return;

    const quota = await getQuota(userId);
    const now = new Date();
    const todayUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);

    if (quota.lifetimeUsed < quota.lifetimeAllowance) return;

    if (quota.dailyGrantedAt && new Date(quota.dailyGrantedAt) >= todayUTC) return;

    const nextMidnightUTC = new Date(todayUTC.getTime() + 24 * 60 * 60 * 1000);

    await query(
      `UPDATE user_quota 
       SET daily_used = 0, daily_quota_granted_at = $2, daily_reset_at = $3
       WHERE user_id = $1`,
      [userId, now, nextMidnightUTC]
    );

    logger.info('Daily quota granted on login', { userId });
  } catch (err) {
    logger.error('Failed to grant daily quota on login', err, { userId });
  }
}

/**
 * Check if user can execute cleanup.
 * Returns { allowed: boolean, remaining: number, reason: string }
 */
async function checkQuota(userId) {
  try {
    const subResult = await query(
      "SELECT plan, status FROM subscription_status WHERE user_id = $1",
      [userId]
    );

    const isPro = subResult.rows[0]?.plan === 'pro' && subResult.rows[0]?.status === 'active';

    if (isPro) {
      return { allowed: true, remaining: Infinity, reason: 'Pro user — unlimited' };
    }

    const quota = await getQuota(userId);

    const lifetimeRemaining = Math.max(0, quota.lifetimeAllowance - quota.lifetimeUsed);
    const dailyRemaining = Math.max(0, quota.dailyAllowance - quota.dailyUsed);

    if (lifetimeRemaining > 0) {
      return {
        allowed: true,
        remaining: lifetimeRemaining,
        reason: `${lifetimeRemaining} emails remaining this lifetime (then 50/day)`,
      };
    }

    if (dailyRemaining > 0) {
      return {
        allowed: true,
        remaining: dailyRemaining,
        reason: `${dailyRemaining} emails remaining today (resets at midnight UTC)`,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      reason: 'Free quota exhausted. Upgrade to Pro for unlimited cleanup.',
    };
  } catch (err) {
    logger.error('Failed to check quota', err, { userId });
    return { allowed: true, remaining: Infinity, reason: 'Error checking quota' };
  }
}

/**
 * Consume quota after a successful cleanup.
 * 
 * FIX: Deducts from LIFETIME first (while available), then DAILY.
 * Previously it was backwards — daily was consumed first, leaving
 * lifetime_used stuck at 0 so the banner never updated.
 */
async function consumeQuota(userId, emailCount) {
  try {
    const quota = await getQuota(userId);

    let lifetimeUsed = quota.lifetimeUsed;
    let dailyUsed = quota.dailyUsed;

    // ── Step 1: Consume from lifetime first ───────────────────────────
    const lifetimeRemaining = Math.max(0, quota.lifetimeAllowance - lifetimeUsed);
    const lifetimeConsume = Math.min(emailCount, lifetimeRemaining);
    lifetimeUsed += lifetimeConsume;

    // ── Step 2: If lifetime is exhausted, overflow into daily ─────────
    const overflow = emailCount - lifetimeConsume;
    if (overflow > 0) {
      const dailyRemaining = Math.max(0, quota.dailyAllowance - dailyUsed);
      const dailyConsume = Math.min(overflow, dailyRemaining);
      dailyUsed += dailyConsume;
    }

    await query(
      `UPDATE user_quota 
       SET lifetime_used = $2, daily_used = $3, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, lifetimeUsed, dailyUsed]
    );

    logger.info('Quota consumed', { userId, emailCount, lifetimeConsume, overflow });
  } catch (err) {
    logger.error('Failed to consume quota', err, { userId, emailCount });
  }
}

/**
 * Get full quota summary for display (admin + user dashboard).
 */
async function getQuotaSummary(userId) {
  try {
    const subResult = await query(
      "SELECT plan, status FROM subscription_status WHERE user_id = $1",
      [userId]
    );

    const isPro = subResult.rows[0]?.plan === 'pro' && subResult.rows[0]?.status === 'active';

    if (isPro) {
      return {
        isPro: true,
        plan: 'pro',
        lifetime: { allowance: null, used: 0, remaining: null },
        daily: { allowance: null, used: 0, remaining: null },
        message: 'You have unlimited cleanup with Pro.',
      };
    }

    const quota = await getQuota(userId);
    const lifetimeRemaining = Math.max(0, quota.lifetimeAllowance - quota.lifetimeUsed);
    const dailyRemaining = Math.max(0, quota.dailyAllowance - quota.dailyUsed);

    return {
      isPro: false,
      plan: 'free',
      lifetime: {
        allowance: quota.lifetimeAllowance,
        used: quota.lifetimeUsed,
        remaining: lifetimeRemaining,
      },
      daily: {
        allowance: quota.dailyAllowance,
        used: quota.dailyUsed,
        remaining: dailyRemaining,
        grantedAt: quota.dailyGrantedAt,
        resetAt: quota.dailyResetAt,
      },
      message:
        lifetimeRemaining > 0
          ? `${lifetimeRemaining} emails remaining this lifetime`
          : `${dailyRemaining} emails remaining today (resets at midnight UTC)`,
    };
  } catch (err) {
    logger.error('Failed to get quota summary', err, { userId });
    return { isPro: false, error: 'Failed to fetch quota' };
  }
}

/**
 * Admin: manually set a user's quota.
 */
async function adminSetQuota(userId, { lifetimeAllowance = 500, lifetimeUsed = 0, dailyAllowance = 50 }) {
  try {
    const now = new Date();
    const nextMidnightUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);

    await query(
      `INSERT INTO user_quota (user_id, lifetime_allowance, lifetime_used, daily_allowance, daily_used, daily_quota_granted_at, daily_reset_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE
       SET lifetime_allowance = $2, lifetime_used = $3, daily_allowance = $4, daily_used = 0, updated_at = NOW()`,
      [userId, lifetimeAllowance, lifetimeUsed, dailyAllowance, 0, null, nextMidnightUTC]
    );

    logger.info('Admin quota adjustment', { userId, lifetimeAllowance, lifetimeUsed, dailyAllowance });
  } catch (err) {
    logger.error('Failed to set admin quota', err, { userId });
    throw err;
  }
}

module.exports = {
  getQuota,
  grantDailyQuotaOnLogin,
  checkQuota,
  consumeQuota,
  getQuotaSummary,
  adminSetQuota,
};
