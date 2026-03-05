// src/services/scanEngine.js
// Detects deletion categories using Gmail API metadata only.
// Implements paged scanning with progress tracking.
// NEVER reads or stores email body content.

const {
  getGmailClient,
  collectMessageIdsByQuery,
  batchGetMessageMetadata,
  getStorageQuota,
  sleep,
} = require('./gmailService');
const { scoreCategory } = require('./confidenceEngine');
const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Gmail search queries for each deletion category.
 * Docs: https://support.google.com/mail/answer/7190
 *
 * All queries intentionally avoid fetching full message bodies.
 * size: filter uses Gmail's estimated size.
 */
const CATEGORY_QUERIES = {
  large_attachments_10mb: {
    label: 'Large attachments (10MB+)',
    description: 'Emails with attachments over 10MB — biggest space savers',
    query: 'has:attachment larger:10M -in:trash -in:spam',
    icon: 'PaperclipIcon',
    color: 'red',
  },
  large_attachments_5mb: {
    label: 'Large attachments (5–10MB)',
    description: 'Emails with attachments between 5MB and 10MB',
    query: 'has:attachment larger:5M smaller:10M -in:trash -in:spam',
    icon: 'PaperclipIcon',
    color: 'orange',
  },
  promotions_90d: {
    label: 'Old promotional emails (90+ days)',
    description: 'Marketing and promotional emails you no longer need',
    query: 'category:promotions older_than:90d -in:trash -is:starred',
    icon: 'TagIcon',
    color: 'purple',
  },
  social_90d: {
    label: 'Old social notifications (90+ days)',
    description: 'Social media and forum notifications',
    query: 'category:social older_than:90d -in:trash -is:starred',
    icon: 'UsersIcon',
    color: 'blue',
  },
  old_emails_3yr: {
    label: 'Emails older than 3 years',
    description: 'General emails more than 3 years old',
    query: 'older_than:3y -in:trash -is:starred -has:attachment',
    icon: 'ClockIcon',
    color: 'gray',
  },
  expired_calendar: {
    label: 'Expired calendar invites',
    description: 'Calendar invitations for events that have already passed',
    query: 'filename:invite.ics OR filename:event.ics older_than:7d -in:trash',
    icon: 'CalendarIcon',
    color: 'green',
  },
  drive_attachments: {
    label: 'Emails with Drive links only',
    description: 'Emails where content is in Google Drive (safe to archive)',
    query: 'has:drive -has:attachment older_than:180d -in:trash -is:starred',
    icon: 'CloudIcon',
    color: 'teal',
  },
};

/**
 * Restrict query to a date window based on scan depth.
 *
 * Rules:
 *  - large_attachments_*  : NEVER restrict by date. Big files from any year are
 *                           worth finding — this is the highest-value cleanup.
 *  - old_emails_3yr       : Already scoped to 'older_than:3y'. Adding 'newer_than:365d'
 *                           creates an IMPOSSIBLE query (can't be both >3yr and <1yr old).
 *                           Skip for '12months'/'24months'; only run for 'all'.
 *  - Everything else      : Add a newer_than window to limit API calls.
 */
function applyDepthFilter(baseQuery, scanDepth, categoryKey) {
  // Large attachments: always scan full history — these are the biggest space hogs
  // and a 3-year-old 50MB email matters just as much as a recent one.
  if (categoryKey === 'large_attachments_10mb' || categoryKey === 'large_attachments_5mb') {
    return baseQuery;
  }

  // old_emails_3yr already has 'older_than:3y'. Adding 'newer_than:365d' (12mo depth)
  // or 'newer_than:730d' (24mo depth) makes the query impossible → always 0 results.
  // Only run this category on 'all' depth scans.
  if (categoryKey === 'old_emails_3yr') {
    return scanDepth === 'all' ? baseQuery : null; // null = skip this category
  }

  if (scanDepth === '12months') return `${baseQuery} newer_than:365d`;
  if (scanDepth === '24months') return `${baseQuery} newer_than:730d`;
  return baseQuery; // 'all' — Pro only
}

/**
 * Run a full scan for a user.
 * Updates the scan record in DB as it progresses.
 * 
 * @param {string} scanId - UUID of the scan record
 * @param {string} userId
 * @param {object} tokens - { accessToken, refreshToken }
 * @param {string} scanDepth - '12months' | '24months' | 'all'
 */
async function runScan(scanId, userId, tokens, scanDepth = '12months') {
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

  try {
    // Update scan status to running
    await query(
      "UPDATE scans SET status = 'running', started_at = NOW() WHERE id = $1",
      [scanId]
    );

    // Step 1: Get storage quota
    logger.info('Fetching storage quota', { scanId, userId });
    let storageInfo;
    try {
      storageInfo = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
    } catch (err) {
      logger.warn('Could not fetch storage quota, using defaults', { err: err.message });
      storageInfo = { storageUsedBytes: 0, storageQuotaBytes: 15 * 1024 * 1024 * 1024 };
    }

    // Scans are uncapped so users can fully see value before purchase.
    const maxMatches = Infinity;
    logger.info(`[SCAN DEBUG] Uncapped scan enabled; maxMatches=${maxMatches}`, { scanId, scanDepth });

    // Step 2: Scan each category
    const categoryResults = [];
    let totalMessagesScanned = 0;
    let totalFreeableBytes = 0;

    for (const [categoryKey, categoryDef] of Object.entries(CATEGORY_QUERIES)) {
      logger.info(`Scanning category: ${categoryKey}`, { scanId });

      const q = applyDepthFilter(categoryDef.query, scanDepth, categoryKey);

      // null means this category is incompatible with the chosen scan depth — skip it
      if (q === null) {
        logger.info(`Skipping category ${categoryKey} — incompatible with depth '${scanDepth}'`, { scanId });
        continue;
      }

      logger.info(`[SCAN DEBUG] Category ${categoryKey}: query="${q}", maxMessages=${maxMatches === Infinity ? 'Infinity' : maxMatches}`, { scanId });
      let messageIds;
      const categoryStart = Date.now();
      try {
        messageIds = await collectMessageIdsByQuery(gmail, q, { maxMessages: maxMatches });
        logger.info(`[SCAN DEBUG] Category ${categoryKey}: found ${messageIds.length} messages in ${Date.now()-categoryStart}ms`, { scanId });
      } catch (err) {
        const status = err?.response?.status || err?.code;
        const errMsg = err?.response?.data?.error?.message || err?.message || String(err);

        // Auth errors — bubble up and fail the scan visibly
        if (status === 401 || status === 403 ||
            errMsg?.includes('invalid_grant') ||
            errMsg?.includes('Token has been expired') ||
            errMsg?.includes('Invalid Credentials')) {
          logger.error('Gmail API auth error — failing scan', { status, errMsg, scanId, categoryKey });
          throw new Error(`Gmail API auth failed (${status}): ${errMsg}. Please log out and log back in.`);
        }

        // Network errors — bubble up so we know if Render can't reach Google
        const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' ||
          err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' ||
          errMsg?.includes('ECONNRESET') || errMsg?.includes('ETIMEDOUT') ||
          errMsg?.includes('network') || errMsg?.includes('socket');
        if (isNetworkError) {
          logger.error('Gmail API network error — outbound connection blocked?', { code: err?.code, errMsg, scanId, categoryKey });
          throw new Error(`Gmail API network error (${err?.code || 'unknown'}): ${errMsg}. Outbound connections to Google may be blocked on this server.`);
        }

        // Non-auth, non-network errors (rate limit, transient 5xx): skip this category only
        logger.warn(`Skipping category ${categoryKey} after error`, { status, errMsg, scanId });
        messageIds = [];
      }

      if (messageIds.length === 0) {
        categoryResults.push({
          key: categoryKey,
          label: categoryDef.label,
          description: categoryDef.description,
          icon: categoryDef.icon,
          color: categoryDef.color,
          messageCount: 0,
          totalBytes: 0,
          estimatedMB: 0,
          tier: 'HIGH',
          score: 95,
          highCount: 0,
          mediumCount: 0,
          reviewCount: 0,
          messages: [],
        });
        continue;
      }

      // Fetch metadata (no body)
      const metadataSampleSize = Math.min(messageIds.length, 2000);
      const metadata = await batchGetMessageMetadata(gmail, messageIds.slice(0, metadataSampleSize));
      totalMessagesScanned += messageIds.length;

      // Build thread count map for reply detection
      const threadCounts = new Map();
      for (const msg of metadata) {
        const current = threadCounts.get(msg.threadId) || 0;
        threadCounts.set(msg.threadId, current + 1);
      }

      // Score category
      const scored = scoreCategory(metadata, categoryKey, threadCounts);
      const avgBytes = metadata.length > 0 ? (scored.totalBytes / metadata.length) : 0;
      const estimatedCategoryBytes = Math.round(avgBytes * messageIds.length);
      totalFreeableBytes += estimatedCategoryBytes;

      categoryResults.push({
        key: categoryKey,
        label: categoryDef.label,
        description: categoryDef.description,
        icon: categoryDef.icon,
        color: categoryDef.color,
        ...scored,
        messageCount: messageIds.length,
        totalBytes: estimatedCategoryBytes,
        estimatedMB: parseFloat((estimatedCategoryBytes / (1024 * 1024)).toFixed(2)),
        cleanup: {
          mode: 'query',
          query: q,
        },
      });

      // Update progress in DB
      await query(
        `UPDATE scans SET
           total_messages_scanned = $1,
           estimated_bytes_freeable = $2,
           categories_json = $3
         WHERE id = $4`,
        [totalMessagesScanned, totalFreeableBytes, JSON.stringify(categoryResults), scanId]
      );
    }

    // Step 3: Calculate storage growth
    const previousScan = await getPreviousScan(userId, scanId);
    const storageGrowthDailyBytes = calculateDailyGrowth(storageInfo.storageUsedBytes, previousScan);
    const estimatedDaysUntilFull = storageGrowthDailyBytes > 0
      ? Math.min(Math.floor((storageInfo.storageQuotaBytes - storageInfo.storageUsedBytes) / storageGrowthDailyBytes), 9999)
      : null;

    const confidenceSummary = buildConfidenceSummary(categoryResults);

    // Step 4: Mark scan complete
    await query(
      `UPDATE scans SET
         status = 'complete',
         storage_used_bytes = $1,
         storage_quota_bytes = $2,
         storage_growth_daily_bytes = $3,
         estimated_days_until_full = $4,
         categories_json = $5,
         confidence_summary = $6,
         estimated_bytes_freeable = $7,
         total_messages_scanned = $8,
         completed_at = NOW()
       WHERE id = $9`,
      [
        storageInfo.storageUsedBytes,
        storageInfo.storageQuotaBytes,
        storageGrowthDailyBytes,
        estimatedDaysUntilFull,
        JSON.stringify(categoryResults),
        JSON.stringify(confidenceSummary),
        totalFreeableBytes,
        totalMessagesScanned,
        scanId,
      ]
    );

    logger.info('Scan complete', { scanId, totalMessagesScanned, totalFreeableBytes });
    return { success: true, scanId };

  } catch (err) {
    logger.error('Scan failed', err, { scanId });
    await query(
      "UPDATE scans SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
      [err.message, scanId]
    );
    throw err;
  }
}

/**
 * Run a custom-query scan for a single user-defined Gmail filter.
 * Produces one category result ("Custom Filter") instead of the 7 preset categories.
 */
async function runCustomScan(scanId, userId, tokens, customQuery) {
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

  try {
    await query("UPDATE scans SET status = 'running', started_at = NOW() WHERE id = $1", [scanId]);

    // Get storage quota
    let storageInfo;
    try {
      storageInfo = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
    } catch {
      storageInfo = { storageUsedBytes: 0, storageQuotaBytes: 15 * 1024 * 1024 * 1024 };
    }

    logger.info('Running custom scan', { scanId, userId, query: customQuery });

    // Custom scans are uncapped so users can fully see value before purchase.
    const maxMatches = Infinity;

    // Collect message IDs matching the custom query
    let messageIds;
    try {
      messageIds = await collectMessageIdsByQuery(gmail, customQuery, { maxMessages: maxMatches });
    } catch (err) {
      logger.warn('Custom scan: failed to list messages', { err: err.message });
      messageIds = [];
    }

    let totalFreeableBytes = 0;
    let categoryResults = [];

    if (messageIds.length > 0) {
      // Keep metadata sampling bounded for performance while still reflecting
      // full match count for cleanup.
      const metadataSampleSize = Math.min(messageIds.length, 2000);
      const metadata = await batchGetMessageMetadata(gmail, messageIds.slice(0, metadataSampleSize));
      const threadCounts = new Map();
      for (const msg of metadata) {
        threadCounts.set(msg.threadId, (threadCounts.get(msg.threadId) || 0) + 1);
      }
      const scored = scoreCategory(metadata, 'custom_filter', threadCounts);
      const avgBytes = metadata.length > 0 ? (scored.totalBytes / metadata.length) : 0;
      totalFreeableBytes = Math.round(avgBytes * messageIds.length);

      categoryResults = [{
        key: 'custom_filter',
        label: 'Custom Filter',
        description: `Matched by: ${customQuery}`,
        icon: 'AdjustmentsIcon',
        color: 'indigo',
        ...scored,
        messageCount: messageIds.length,
        totalBytes: totalFreeableBytes,
        estimatedMB: parseFloat((totalFreeableBytes / (1024 * 1024)).toFixed(2)),
        cleanup: {
          mode: 'query',
          query: customQuery,
        },
      }];
    }

    const confidenceSummary = buildConfidenceSummary(categoryResults);

    await query(
      `UPDATE scans SET
         status = 'complete',
         storage_used_bytes = $1,
         storage_quota_bytes = $2,
         storage_growth_daily_bytes = 0,
         categories_json = $3,
         confidence_summary = $4,
         estimated_bytes_freeable = $5,
         total_messages_scanned = $6,
         completed_at = NOW()
       WHERE id = $7`,
      [
        storageInfo.storageUsedBytes,
        storageInfo.storageQuotaBytes,
        JSON.stringify(categoryResults),
        JSON.stringify(confidenceSummary),
        totalFreeableBytes,
        messageIds.length,
        scanId,
      ]
    );

    logger.info('Custom scan complete', { scanId, matches: messageIds.length });
  } catch (err) {
    logger.error('Custom scan failed', err, { scanId });
    await query(
      "UPDATE scans SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2",
      [err.message, scanId]
    );
    throw err;
  }
}

/**
 * Get the most recent completed scan for delta storage calculation
 */
async function getPreviousScan(userId, currentScanId) {
  const result = await query(
    `SELECT storage_used_bytes, completed_at
     FROM scans
     WHERE user_id = $1 AND status = 'complete' AND id != $2
     ORDER BY completed_at DESC LIMIT 1`,
    [userId, currentScanId]
  );
  return result.rows[0] || null;
}

/**
 * Calculate daily storage growth rate.
 * Growth = (current - previous) / days_between_scans
 */
function calculateDailyGrowth(currentBytes, previousScan) {
  if (!previousScan || !previousScan.storage_used_bytes) return 0;

  const daysBetween = Math.max(
    1,
    (Date.now() - new Date(previousScan.completed_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const growth = currentBytes - previousScan.storage_used_bytes;
  if (growth <= 0) return 0;

  return Math.floor(growth / daysBetween);
}

/**
 * Build a summary of confidence tiers across all categories
 */
function buildConfidenceSummary(categoryResults) {
  const summary = { HIGH: 0, MEDIUM: 0, REVIEW_REQUIRED: 0, totalMessages: 0 };
  for (const cat of categoryResults) {
    summary.HIGH += cat.highCount || 0;
    summary.MEDIUM += cat.mediumCount || 0;
    summary.REVIEW_REQUIRED += cat.reviewCount || 0;
    summary.totalMessages += cat.messageCount || 0;
  }
  return summary;
}

module.exports = { runScan, runCustomScan, CATEGORY_QUERIES };
