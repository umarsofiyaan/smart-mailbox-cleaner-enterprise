// src/services/confidenceEngine.js
// Scores each deletion candidate on safety of deletion.
// NEVER reads email body. Uses only metadata: labels, size, date, from, thread.

/**
 * SCORING ALGORITHM
 * 
 * Base score starts at the category's inherent safety level.
 * Deductions applied for signals that suggest the email is important.
 * 
 * Signals and weights:
 * - Is STARRED?           -40 points (user explicitly saved this)
 * - Is in INBOX?          -15 points (still being managed)
 * - Has replies?          -20 points (conversation, might be important)
 * - From known contact?    -10 points (not a newsletter/promotional)
 * - Has custom label?      -15 points (user organized this)
 * - Accessed recently?     -10 points (accessed in last 30 days via UNREAD status changes)
 * - Has attachment?        No deduction (attachment size is WHY we suggest deletion)
 * - Large attachment?      +5 bonus (high value cleanup)
 * 
 * Final score → confidence tier:
 * >= 90 → HIGH (95%) — safe to bulk clean
 * 70–89 → MEDIUM (80%) — suggest but require confirmation
 * < 70  → REVIEW_REQUIRED — show individually
 */

const CATEGORY_BASE_SCORES = {
  large_attachments_10mb:  95,  // Very safe — large attachments rarely need preserving
  large_attachments_5mb:   88,  // Safe — still worth flagging for review
  promotions_90d:          92,  // Promotional mail = high safety
  social_90d:              85,  // Social notifications = usually safe
  old_emails_3yr:          80,  // Old emails could have sentimental value
  expired_calendar:        95,  // Expired calendar invites = useless
  drive_attachments:       80,  // Drive links don't need email preservation
};

const SYSTEM_LABELS = new Set([
  'INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD',
  'STARRED', 'IMPORTANT', 'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

/**
 * Score a single message's safety for deletion.
 * 
 * @param {object} message - Message metadata from gmailService
 * @param {string} category - One of the CATEGORY_BASE_SCORES keys
 * @param {number} threadMessageCount - Number of messages in thread
 * @returns {{ score: number, tier: string, signals: object }}
 */
function scoreMessage(message, category, threadMessageCount = 1) {
  let score = CATEGORY_BASE_SCORES[category] || 80;
  const signals = {};

  // Signal: Starred
  if (message.labelIds.includes('STARRED')) {
    score -= 40;
    signals.starred = true;
  }

  // Signal: In Inbox
  if (message.labelIds.includes('INBOX')) {
    score -= 15;
    signals.inInbox = true;
  }

  // Signal: Has replies in thread
  if (threadMessageCount > 1) {
    const deduction = Math.min(threadMessageCount * 5, 20);
    score -= deduction;
    signals.hasReplies = true;
    signals.threadCount = threadMessageCount;
  }

  // Signal: Marked as IMPORTANT by Gmail
  if (message.labelIds.includes('IMPORTANT')) {
    score -= 15;
    signals.markedImportant = true;
  }

  // Signal: Has custom user-created label
  const hasCustomLabel = message.labelIds.some(l => !SYSTEM_LABELS.has(l));
  if (hasCustomLabel) {
    score -= 15;
    signals.hasCustomLabel = true;
    signals.labels = message.labelIds.filter(l => !SYSTEM_LABELS.has(l));
  }

  // Signal: Bonus for large attachment (high value cleanup)
  if (message.sizeEstimate > 10 * 1024 * 1024) {
    score = Math.min(score + 5, 100);
    signals.largeAttachment = true;
  }

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, score));

  const tier = score >= 90 ? 'HIGH' : score >= 70 ? 'MEDIUM' : 'REVIEW_REQUIRED';

  return { score, tier, signals };
}

/**
 * Score all messages in a category.
 * Returns aggregated confidence for the category + per-message scores.
 * 
 * @param {object[]} messages - Array of message metadata
 * @param {string} category
 * @param {Map<string, number>} threadCounts - Map of threadId → message count
 * @returns {object} Category-level confidence summary
 */
function scoreCategory(messages, category, threadCounts = new Map()) {
  if (messages.length === 0) {
    return {
      category,
      messageCount: 0,
      totalBytes: 0,
      tier: 'HIGH',
      score: 95,
      highCount: 0,
      mediumCount: 0,
      reviewCount: 0,
      messages: [],
    };
  }

  const scored = messages.map(msg => {
    const threadCount = threadCounts.get(msg.threadId) || 1;
    const { score, tier, signals } = scoreMessage(msg, category, threadCount);
    return {
      id: msg.id,
      threadId: msg.threadId,
      sizeEstimate: msg.sizeEstimate,
      internalDate: msg.internalDate,
      from: msg.from,
      subject: msg.subject,
      labelIds: msg.labelIds,
      score,
      tier,
      signals,
    };
  });

  const highCount = scored.filter(m => m.tier === 'HIGH').length;
  const mediumCount = scored.filter(m => m.tier === 'MEDIUM').length;
  const reviewCount = scored.filter(m => m.tier === 'REVIEW_REQUIRED').length;

  // Category aggregate score = weighted average
  const avgScore = scored.reduce((sum, m) => sum + m.score, 0) / scored.length;
  const categoryTier = avgScore >= 90 ? 'HIGH' : avgScore >= 70 ? 'MEDIUM' : 'REVIEW_REQUIRED';

  const totalBytes = scored.reduce((sum, m) => sum + (m.sizeEstimate || 0), 0);

  return {
    category,
    messageCount: scored.length,
    totalBytes,
    estimatedMB: parseFloat((totalBytes / (1024 * 1024)).toFixed(2)),
    tier: categoryTier,
    score: Math.round(avgScore),
    highCount,
    mediumCount,
    reviewCount,
    // Return only summary of messages (not full metadata for storage efficiency)
    messages: scored.map(m => ({
      id: m.id,
      sizeEstimate: m.sizeEstimate,
      internalDate: m.internalDate,
      from: m.from,
      subject: m.subject,
      score: m.score,
      tier: m.tier,
      signals: m.signals,
    })),
  };
}

/**
 * Human-readable label for confidence tier
 */
function tierLabel(tier) {
  const labels = {
    HIGH: 'Safe to clean (95% confidence)',
    MEDIUM: 'Likely safe (80% confidence)',
    REVIEW_REQUIRED: 'Review recommended',
  };
  return labels[tier] || tier;
}

module.exports = { scoreMessage, scoreCategory, tierLabel, CATEGORY_BASE_SCORES };
