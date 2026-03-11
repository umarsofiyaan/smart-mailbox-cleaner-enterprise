// src/services/confidenceEngine.js
// Scores each deletion candidate on safety of deletion.
// NEVER reads email body. Uses only metadata: labels, size, date, from, thread.

/**
 * ─── SCORING ALGORITHM ────────────────────────────────────────────────────────
 *
 * Each email starts at a base score set by its category (how inherently safe
 * that category is), then deductions/bonuses are applied for signals that
 * suggest the email is — or isn't — important to the user.
 *
 * DEDUCTIONS (bad — suggests importance):
 *  -50  Starred              User explicitly saved this email
 *  -35  Important + Inbox    Gmail's AI flagged it important AND user hasn't archived it
 *  -25  Unread in Inbox      User hasn't even opened it yet
 *  -20  Important label      Gmail's AI considers this email significant
 *  -20  Active thread (4+)   Multi-person conversation with many replies
 *  -15  Thread reply (2-3)   Some back-and-forth, could be a conversation to keep
 *  -15  Custom label         User manually created a label and applied it — intentional organization
 *  -15  In Inbox (read)      User has read it but kept it in inbox — still being managed
 *  -10  Recent (< 30 days)   Fresh email — too new to be confident about deleting
 *
 * BONUSES (good — makes deletion safer):
 *  +10  From noreply/newsletter domain  Clearly automated — not a person
 *  +8   Older than 1 year               Old enough to be safe for non-attachment categories
 *  +5   Large attachment (>10MB)        High-value space cleanup
 *
 * FINAL TIERS:
 *  ≥ 85  → SAFE TO DELETE        Very clear signals this is bulk/automated/old
 *  65–84 → LIKELY SAFE           Probably fine but worth a quick glance
 *  < 65  → NEEDS REVIEW          Strong signals this matters — check before deleting
 */

const CATEGORY_BASE_SCORES = {
  large_attachments_10mb:  90,   // Large attachments are the main reason to delete; very safe
  large_attachments_5mb:   82,   // Slightly lower — smaller files, still worth checking
  promotions_90d:          88,   // Promotional mail = high safety
  social_90d:              80,   // Social notifications = usually safe
  old_emails_3yr:          75,   // Old emails could still have value
  expired_calendar:        92,   // Expired calendar invites = truly useless
  drive_attachments:       78,   // Drive links don't need email but user may want the context
  custom_filter:           72,   // Unknown filter — be conservative
};

// System labels we don't want to confuse with user-created labels
const SYSTEM_LABELS = new Set([
  'INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD',
  'STARRED', 'IMPORTANT',
  'CATEGORY_PERSONAL', 'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
]);

// Patterns in the From header that reliably indicate automated/newsletter senders
const AUTOMATED_SENDER_PATTERNS = [
  /noreply/i,
  /no-reply/i,
  /donotreply/i,
  /do-not-reply/i,
  /notifications?@/i,
  /newsletter/i,
  /mailer@/i,
  /updates?@/i,
  /alerts?@/i,
  /automated?@/i,
  /info@.*\.(com|io|co|net)$/i,
  /hello@.*\.(com|io|co|net)$/i,
  /team@.*\.(com|io|co|net)$/i,
];

function isAutomatedSender(fromHeader = '') {
  const lower = fromHeader.toLowerCase();
  return AUTOMATED_SENDER_PATTERNS.some(p => p.test(lower));
}

function getEmailAgeMs(internalDate) {
  if (!internalDate) return 0;
  return Date.now() - Number(internalDate);
}

const DAY_MS   = 1000 * 60 * 60 * 24;
const YEAR_MS  = 365 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/**
 * Score a single message for safety of deletion.
 */
function scoreMessage(message, category, threadMessageCount = 1) {
  let score = CATEGORY_BASE_SCORES[category] || 72;
  const signals = {};
  const ageMs = getEmailAgeMs(message.internalDate);

  // ── Deductions ────────────────────────────────────────────────────────────

  // Starred: user explicitly saved this — strongest signal
  if (message.labelIds.includes('STARRED')) {
    score -= 50;
    signals.starred = true;
  }

  // Important + still in Inbox: Gmail's AI says this matters AND user hasn't archived it
  if (message.labelIds.includes('IMPORTANT') && message.labelIds.includes('INBOX')) {
    score -= 35;
    signals.importantInInbox = true;
  } else if (message.labelIds.includes('IMPORTANT')) {
    // Important but archived — still notable
    score -= 20;
    signals.markedImportant = true;
  } else if (message.labelIds.includes('INBOX') && message.labelIds.includes('UNREAD')) {
    // Unread inbox email — user hasn't even seen it yet
    score -= 25;
    signals.unreadInbox = true;
  } else if (message.labelIds.includes('INBOX')) {
    // Read inbox email — user processed it but kept it
    score -= 15;
    signals.inInbox = true;
  }

  // Thread activity: back-and-forth conversations are more likely to be important
  if (threadMessageCount >= 4) {
    score -= 20;
    signals.activeThread = true;
    signals.threadCount = threadMessageCount;
  } else if (threadMessageCount >= 2) {
    score -= 15;
    signals.hasReplies = true;
    signals.threadCount = threadMessageCount;
  }

  // Custom user-created label: user intentionally organised this email
  const customLabels = message.labelIds.filter(l => !SYSTEM_LABELS.has(l));
  if (customLabels.length > 0) {
    score -= 15;
    signals.hasCustomLabel = true;
    signals.labels = customLabels;
  }

  // Recency: emails less than 30 days old — too fresh to be confident
  if (ageMs < MONTH_MS) {
    score -= 10;
    signals.recentEmail = true;
  }

  // ── Bonuses ───────────────────────────────────────────────────────────────

  // Automated sender: reliably not a personal/important contact
  if (isAutomatedSender(message.from)) {
    score += 10;
    signals.automatedSender = true;
  }

  // Old email: emails older than 1 year are generally safer to delete
  if (ageMs > YEAR_MS) {
    score += 8;
    signals.oldEmail = true;
  }

  // Large attachment: high-value space cleanup, deletion is usually the goal
  if (message.sizeEstimate > 10 * 1024 * 1024) {
    score += 5;
    signals.largeAttachment = true;
  }

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, score));

  // ── Tier thresholds ───────────────────────────────────────────────────────
  // 85+  → SAFE TO DELETE   (clearly bulk/automated/old, no important signals)
  // 65–84 → LIKELY SAFE     (probably fine, quick glance recommended)
  // <65   → NEEDS REVIEW    (has strong importance signals)
  const tier = score >= 85 ? 'HIGH' : score >= 65 ? 'MEDIUM' : 'REVIEW_REQUIRED';

  return { score, tier, signals };
}

/**
 * Score all messages in a category.
 * Returns aggregated confidence + per-message scores (all of them — no cap).
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
      id:           msg.id,
      threadId:     msg.threadId,
      sizeEstimate: msg.sizeEstimate,
      internalDate: msg.internalDate,
      from:         msg.from,
      subject:      msg.subject,
      labelIds:     msg.labelIds,
      score,
      tier,
      signals,
    };
  });

  const highCount   = scored.filter(m => m.tier === 'HIGH').length;
  const mediumCount = scored.filter(m => m.tier === 'MEDIUM').length;
  const reviewCount = scored.filter(m => m.tier === 'REVIEW_REQUIRED').length;

  const avgScore = scored.reduce((sum, m) => sum + m.score, 0) / scored.length;
  const categoryTier = avgScore >= 85 ? 'HIGH' : avgScore >= 65 ? 'MEDIUM' : 'REVIEW_REQUIRED';
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
    messages: scored.map(m => ({
      id:           m.id,
      sizeEstimate: m.sizeEstimate,
      internalDate: m.internalDate,
      from:         m.from,
      subject:      m.subject,
      score:        m.score,
      tier:         m.tier,
      signals:      m.signals,
    })),
  };
}

function tierLabel(tier) {
  return {
    HIGH:             'Safe to Delete',
    MEDIUM:           'Likely Safe',
    REVIEW_REQUIRED:  'Needs Review',
  }[tier] || tier;
}

module.exports = { scoreMessage, scoreCategory, tierLabel, CATEGORY_BASE_SCORES };
