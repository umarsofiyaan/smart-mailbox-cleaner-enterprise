const { query } = require('../config/database');
const { getOAuthTokens } = require('../services/tokenService');
const { checkQuota, consumeQuota } = require('../services/quotaService');
const {
  getGmailClient,
  collectMessageIdsByQuery,
  batchTrashMessages,
  getStorageQuota,
} = require('../services/gmailService');
const logger = require('../utils/logger');

const AUTO_CLEAN_PROMOTIONS_QUERY = 'category:promotions older_than:30d -in:trash -is:starred';
const AUTO_CLEAN_NEWSLETTER_QUERY = 'subject:(newsletter) older_than:30d -in:trash -is:starred';

function shouldRunForFrequency(frequency, lastRunAt) {
  if (!lastRunAt) return true;
  const now = new Date();
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  const diffMs = now.getTime() - last.getTime();
  if (frequency === 'daily') return diffMs >= 24 * 60 * 60 * 1000;
  return diffMs >= 7 * 24 * 60 * 60 * 1000;
}

async function runForUser(userRow) {
  const userId = userRow.id;
  if (!shouldRunForFrequency(userRow.auto_clean_frequency || 'weekly', userRow.auto_clean_last_run_at)) {
    return { userId, skipped: true, reason: 'frequency_window_not_elapsed' };
  }

  const tokens = await getOAuthTokens(userId);
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

  // Optional guardrail: skip cleanup if mailbox is already below configured threshold.
  const quota = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
  const usedMb = Math.round((Number(quota.storageUsedBytes || 0)) / (1024 * 1024));
  const maxInboxMb = Number(userRow.auto_clean_max_inbox_mb || 5120);
  if (usedMb <= maxInboxMb) {
    await query(
      `UPDATE users
       SET auto_clean_last_run_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return { userId, skipped: true, reason: 'below_threshold', usedMb, maxInboxMb };
  }

  const [promoIds, newsletterIds] = await Promise.all([
    collectMessageIdsByQuery(gmail, AUTO_CLEAN_PROMOTIONS_QUERY, { maxMessages: 500 }),
    collectMessageIdsByQuery(gmail, AUTO_CLEAN_NEWSLETTER_QUERY, { maxMessages: 500 }),
  ]);

  const candidates = Array.from(new Set([...(promoIds || []), ...(newsletterIds || [])])).slice(0, 500);
  if (!candidates.length) {
    await query(
      `UPDATE users
       SET auto_clean_last_run_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return { userId, skipped: true, reason: 'no_candidates' };
  }

  const quotaCheck = await checkQuota(userId, candidates.length);
  if (!quotaCheck.allowed) {
    return { userId, skipped: true, reason: 'PAYWALL_REQUIRED' };
  }

  const allowedCount = Number.isFinite(quotaCheck.remaining)
    ? Math.min(candidates.length, quotaCheck.remaining)
    : candidates.length;
  const toDelete = candidates.slice(0, allowedCount);
  const result = await batchTrashMessages(gmail, toDelete);

  await consumeQuota(userId, result.success.length);
  await query(
    `UPDATE users
     SET auto_clean_last_run_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [userId]
  );

  return {
    userId,
    successCount: result.success.length,
    failedCount: result.failed.length,
  };
}

async function runAutoCleanupJob() {
  try {
    const usersRes = await query(
      `SELECT id, auto_clean_frequency, auto_clean_last_run_at, auto_clean_max_inbox_mb
       FROM users
       WHERE auto_clean_enabled = TRUE
         AND deleted_at IS NULL`
    );

    if (!usersRes.rows.length) return;

    for (const row of usersRes.rows) {
      try {
        const summary = await runForUser(row);
        logger.info('Auto cleanup processed user', summary);
      } catch (err) {
        logger.warn('Auto cleanup failed for user', { userId: row.id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('Auto cleanup job failed', err);
  }
}

module.exports = { runAutoCleanupJob };
