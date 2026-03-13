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

function applyDepthFilter(baseQuery, scanDepth, categoryKey) {
  if (categoryKey === 'large_attachments_10mb' || categoryKey === 'large_attachments_5mb') {
    return baseQuery;
  }
  if (categoryKey === 'old_emails_3yr') {
    return scanDepth === 'all' ? baseQuery : null;
  }
  if (scanDepth === '12months') return `${baseQuery} newer_than:365d`;
  if (scanDepth === '24months') return `${baseQuery} newer_than:730d`;
  return baseQuery;
}



const KNOWN_NEWSLETTER_DOMAINS = new Set([
  'linkedin.com', 'mail.linkedin.com', 'medium.com', 'substack.com', 'mailchimp.com',
  'sendgrid.net', 'hubspot.com', 'convertkit.com', 'noreply.medium.com', 'github.com',
]);

function extractSenderEmail(from = '') {
  const raw = String(from || '').trim();
  const angled = raw.match(/<([^>]+)>/);
  const email = (angled ? angled[1] : raw).replace(/^"|"$/g, '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}

function extractSenderDomain(from = '') {
  const email = extractSenderEmail(from);
  const domain = email.split('@')[1] || '';
  return domain.toLowerCase();
}

function isNewsletterMessage(msg) {
  const domain = extractSenderDomain(msg?.from || '');
  const listUnsub = String(msg?.listUnsubscribe || '').trim();
  const snippet = String(msg?.snippet || '').toLowerCase();
  const hasUnsubscribeInSnippet = /(unsubscribe|manage preferences|email preferences)/i.test(snippet);
  return Boolean(listUnsub || hasUnsubscribeInSnippet || KNOWN_NEWSLETTER_DOMAINS.has(domain));
}

function computeHealthScore({ totalEmails = 0, unreadEmails = 0, newsletterEmails = 0 }) {
  let score = 100;
  score -= Math.floor(Number(totalEmails || 0) / 500);
  score -= Math.floor(Number(unreadEmails || 0) / 200);
  score -= Math.floor(Number(newsletterEmails || 0) / 100);
  return Math.max(0, Math.min(100, score));
}

async function persistNewsletterSubscriptions(userId, newsletterMap) {
  const entries = Array.from(newsletterMap.values());
  for (const item of entries) {
    await query(
      `INSERT INTO newsletter_subscriptions
         (user_id, sender_domain, sender_email, email_count, unsubscribe_link, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (user_id, sender_domain)
       DO UPDATE SET
         sender_email = COALESCE(EXCLUDED.sender_email, newsletter_subscriptions.sender_email),
         email_count = EXCLUDED.email_count,
         unsubscribe_link = COALESCE(EXCLUDED.unsubscribe_link, newsletter_subscriptions.unsubscribe_link)`,
      [userId, item.domain, item.senderEmail || null, item.count || 0, item.unsubscribeLink || null]
    );
  }
}

async function collectInboxAnalytics(gmail, userId, storageInfo, scanDepth = '12months') {
  const depthSuffix = scanDepth === '24months' ? ' newer_than:730d' : scanDepth === '12months' ? ' newer_than:365d' : '';
  const baseQuery = `-in:trash -in:spam${depthSuffix}`;

  const allIds = await collectMessageIdsByQuery(gmail, baseQuery, { maxMessages: 5000 });
  const unreadIds = await collectMessageIdsByQuery(gmail, `is:unread ${baseQuery}`, { maxMessages: 5000 });
  const promoIds = await collectMessageIdsByQuery(gmail, `category:promotions ${baseQuery}`, { maxMessages: 5000 });

  const sampleIds = allIds.slice(0, 2000);
  const metadata = sampleIds.length ? await batchGetMessageMetadata(gmail, sampleIds) : [];

  const senderFrequency = {};
  const topSenderMap = new Map();
  const newsletterMap = new Map();

  for (const msg of metadata) {
    const domain = extractSenderDomain(msg.from);
    if (!domain) continue;
    senderFrequency[domain] = (senderFrequency[domain] || 0) + 1;
    topSenderMap.set(domain, (topSenderMap.get(domain) || 0) + 1);

    if (isNewsletterMessage(msg)) {
      const prev = newsletterMap.get(domain) || {
        domain,
        count: 0,
        senderEmail: extractSenderEmail(msg.from),
        unsubscribeLink: msg.listUnsubscribe || null,
      };
      prev.count += 1;
      if (!prev.unsubscribeLink && msg.listUnsubscribe) prev.unsubscribeLink = msg.listUnsubscribe;
      newsletterMap.set(domain, prev);
    }
  }

  const sampleCount = Math.max(1, metadata.length);
  const ratio = allIds.length > sampleCount ? (allIds.length / sampleCount) : 1;
  const newsletterEstimatedCount = Math.round(Array.from(newsletterMap.values()).reduce((a, b) => a + b.count, 0) * ratio);

  const topSenders = Array.from(topSenderMap.entries())
    .map(([sender, count]) => ({ sender, count: Math.round(count * ratio) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  const newsletterSenders = Array.from(newsletterMap.values())
    .map((v) => ({ sender: v.domain, count: Math.round(v.count * ratio) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const healthScore = computeHealthScore({
    totalEmails: allIds.length,
    unreadEmails: unreadIds.length,
    newsletterEmails: newsletterEstimatedCount,
  });

  await persistNewsletterSubscriptions(
    userId,
    new Map(Array.from(newsletterMap.entries()).map(([k, v]) => [k, { ...v, count: Math.round(v.count * ratio) }]))
  );

  await query(
    `INSERT INTO inbox_health
       (user_id, total_emails, unread_emails, newsletter_emails, promotional_emails, storage_used_mb, health_score)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      allIds.length,
      unreadIds.length,
      newsletterEstimatedCount,
      promoIds.length,
      Math.round((Number(storageInfo?.storageUsedBytes || 0)) / (1024 * 1024)),
      healthScore,
    ]
  );

  return {
    emailsFound: allIds.length,
    topSenders,
    newsletterSenders,
    senderFrequency,
    healthScore,
    estimatedStorageMB: Math.round((Number(storageInfo?.storageUsedBytes || 0)) / (1024 * 1024)),
  };
}
async function runScan(scanId, userId, tokens, scanDepth = '12months') {
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

  try {
    await query(
      "UPDATE scans SET status = 'running', started_at = NOW() WHERE id = $1",
      [scanId]
    );

    let storageInfo;
    try {
      storageInfo = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
    } catch (err) {
      logger.warn('Could not fetch storage quota, using defaults', { err: err.message });
      storageInfo = { storageUsedBytes: 0, storageQuotaBytes: 15 * 1024 * 1024 * 1024 };
    }

    const categoryResults = [];
    let totalMessagesScanned = 0;
    let totalFreeableBytes = 0;

    for (const [categoryKey, categoryDef] of Object.entries(CATEGORY_QUERIES)) {
      logger.info(`Scanning category: ${categoryKey}`, { scanId });

      const q = applyDepthFilter(categoryDef.query, scanDepth, categoryKey);
      if (q === null) {
        logger.info(`Skipping category ${categoryKey} — incompatible with depth '${scanDepth}'`, { scanId });
        continue;
      }

      let messageIds;
      try {
        messageIds = await collectMessageIdsByQuery(gmail, q, { maxMessages: Infinity });
        logger.info(`Category ${categoryKey}: found ${messageIds.length} messages`, { scanId });
      } catch (err) {
        const status = err?.response?.status || err?.code;
        const errMsg = err?.response?.data?.error?.message || err?.message || String(err);

        if (status === 401 || status === 403 || errMsg?.includes('invalid_grant') || errMsg?.includes('Token has been expired') || errMsg?.includes('Invalid Credentials')) {
          throw new Error(`Gmail API auth failed (${status}): ${errMsg}. Please log out and log back in.`);
        }

        const isNetworkError = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || errMsg?.includes('ECONNRESET') || errMsg?.includes('ETIMEDOUT') || errMsg?.includes('network') || errMsg?.includes('socket');
        if (isNetworkError) {
          throw new Error(`Gmail API network error (${err?.code || 'unknown'}): ${errMsg}`);
        }

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

      // Sample up to 2000 messages for metadata to avoid rate-limiting on large result sets.
      const metadataSampleSize = Math.min(messageIds.length, 2000);
      const metadata = await batchGetMessageMetadata(gmail, messageIds.slice(0, metadataSampleSize));
      totalMessagesScanned += messageIds.length;

      const threadCounts = new Map();
      for (const msg of metadata) {
        threadCounts.set(msg.threadId, (threadCounts.get(msg.threadId) || 0) + 1);
      }

      const scored = scoreCategory(metadata, categoryKey, threadCounts);

      // Extrapolate bytes from sample to full dataset
      const avgBytes = metadata.length > 0 ? (scored.totalBytes / metadata.length) : 0;
      const estimatedCategoryBytes = Math.round(avgBytes * messageIds.length);
      totalFreeableBytes += estimatedCategoryBytes;

      // Scale tier counts from sample to full dataset proportionally
      const sampleSize = metadata.length;
      const totalCount = messageIds.length;
      const sampleRatio = sampleSize > 0 && sampleSize < totalCount ? totalCount / sampleSize : 1;
      const scaledHighCount   = Math.round((scored.highCount   || 0) * sampleRatio);
      const scaledMediumCount = Math.round((scored.mediumCount || 0) * sampleRatio);
      const scaledReviewCount = Math.max(0, totalCount - scaledHighCount - scaledMediumCount);

      categoryResults.push({
        key: categoryKey,
        label: categoryDef.label,
        description: categoryDef.description,
        icon: categoryDef.icon,
        color: categoryDef.color,
        ...scored,
        messageCount: totalCount,
        highCount:    scaledHighCount,
        mediumCount:  scaledMediumCount,
        reviewCount:  scaledReviewCount,
        sampleSize:   sampleSize < totalCount ? sampleSize : undefined,
        totalBytes: estimatedCategoryBytes,
        estimatedMB: parseFloat((estimatedCategoryBytes / (1024 * 1024)).toFixed(2)),
        cleanup: { mode: 'query', query: q },
      });

      await query(
        `UPDATE scans SET
           total_messages_scanned = $1,
           estimated_bytes_freeable = $2,
           categories_json = $3
         WHERE id = $4`,
        [totalMessagesScanned, totalFreeableBytes, JSON.stringify(categoryResults), scanId]
      );
    }

    const previousScan = await getPreviousScan(userId, scanId);
    const storageGrowthDailyBytes = calculateDailyGrowth(storageInfo.storageUsedBytes, previousScan);
    const estimatedDaysUntilFull = storageGrowthDailyBytes > 0
      ? Math.min(Math.floor((storageInfo.storageQuotaBytes - storageInfo.storageUsedBytes) / storageGrowthDailyBytes), 9999)
      : null;

    const confidenceSummary = buildConfidenceSummary(categoryResults);
    const analytics = await collectInboxAnalytics(gmail, userId, storageInfo, scanDepth);

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
         top_senders_json = $9,
         newsletter_senders_json = $10,
         sender_frequency_json = $11,
         health_score = $12,
         estimated_storage_mb = $13,
         completed_at = NOW()
       WHERE id = $14`,
      [
        storageInfo.storageUsedBytes,
        storageInfo.storageQuotaBytes,
        storageGrowthDailyBytes,
        estimatedDaysUntilFull,
        JSON.stringify(categoryResults),
        JSON.stringify(confidenceSummary),
        totalFreeableBytes,
        totalMessagesScanned,
        JSON.stringify(analytics.topSenders || []),
        JSON.stringify(analytics.newsletterSenders || []),
        JSON.stringify(analytics.senderFrequency || {}),
        Number(analytics.healthScore || 0),
        Number(analytics.estimatedStorageMB || 0),
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

async function runCustomScan(scanId, userId, tokens, customQuery) {
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

  try {
    await query("UPDATE scans SET status = 'running', started_at = NOW() WHERE id = $1", [scanId]);

    let storageInfo;
    try {
      storageInfo = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
    } catch {
      storageInfo = { storageUsedBytes: 0, storageQuotaBytes: 15 * 1024 * 1024 * 1024 };
    }

    logger.info('Running custom scan', { scanId, userId, query: customQuery });

    let messageIds;
    try {
      messageIds = await collectMessageIdsByQuery(gmail, customQuery, { maxMessages: Infinity });
    } catch (err) {
      logger.warn('Custom scan: failed to list messages', { err: err.message });
      messageIds = [];
    }

    let totalFreeableBytes = 0;
    let categoryResults = [];

    if (messageIds.length > 0) {
      // Sample up to 2000 messages for metadata to avoid rate-limiting on large result sets.
      const metadataSampleSize = Math.min(messageIds.length, 2000);
      const metadata = await batchGetMessageMetadata(gmail, messageIds.slice(0, metadataSampleSize));
      const threadCounts = new Map();
      for (const msg of metadata) {
        threadCounts.set(msg.threadId, (threadCounts.get(msg.threadId) || 0) + 1);
      }

      const scored = scoreCategory(metadata, 'custom_filter', threadCounts);

      // Extrapolate bytes from sample to full dataset
      const avgBytes = metadata.length > 0 ? (scored.totalBytes / metadata.length) : 0;
      totalFreeableBytes = Math.round(avgBytes * messageIds.length);

      // Scale tier counts from sample to full dataset proportionally
      const sampleSize = metadata.length;
      const totalCount = messageIds.length;
      const sampleRatio = sampleSize > 0 && sampleSize < totalCount ? totalCount / sampleSize : 1;
      const scaledHighCount   = Math.round((scored.highCount   || 0) * sampleRatio);
      const scaledMediumCount = Math.round((scored.mediumCount || 0) * sampleRatio);
      const scaledReviewCount = Math.max(0, totalCount - scaledHighCount - scaledMediumCount);

      categoryResults = [{
        key: 'custom_filter',
        label: 'Custom Filter',
        description: `Matched by: ${customQuery}`,
        icon: 'AdjustmentsIcon',
        color: 'indigo',
        ...scored,
        messageCount: totalCount,
        highCount:    scaledHighCount,
        mediumCount:  scaledMediumCount,
        reviewCount:  scaledReviewCount,
        sampleSize:   sampleSize < totalCount ? sampleSize : undefined,
        totalBytes: totalFreeableBytes,
        estimatedMB: parseFloat((totalFreeableBytes / (1024 * 1024)).toFixed(2)),
        cleanup: { mode: 'query', query: customQuery },
      }];
    }

    const confidenceSummary = buildConfidenceSummary(categoryResults);
    const analytics = await collectInboxAnalytics(gmail, userId, storageInfo, 'all');

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
         top_senders_json = $7,
         newsletter_senders_json = $8,
         sender_frequency_json = $9,
         health_score = $10,
         estimated_storage_mb = $11,
         completed_at = NOW()
       WHERE id = $12`,
      [
        storageInfo.storageUsedBytes,
        storageInfo.storageQuotaBytes,
        JSON.stringify(categoryResults),
        JSON.stringify(confidenceSummary),
        totalFreeableBytes,
        messageIds.length,
        JSON.stringify(analytics.topSenders || []),
        JSON.stringify(analytics.newsletterSenders || []),
        JSON.stringify(analytics.senderFrequency || {}),
        Number(analytics.healthScore || 0),
        Number(analytics.estimatedStorageMB || 0),
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
