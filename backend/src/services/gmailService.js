// src/services/gmailService.js
// All Gmail API interactions. NEVER fetches or stores email body content.
const { google } = require('googleapis');
const { createAuthenticatedClient } = require('../config/google');
const logger = require('../utils/logger');

const GMAIL_RATE_LIMIT_DELAY = parseInt(process.env.GMAIL_RATE_LIMIT_DELAY_MS, 10) || 50;
const QUERY_PAGE_DELAY_MS = parseInt(process.env.GMAIL_QUERY_PAGE_DELAY_MS, 10) || 50;
const TRASH_BATCH_DELAY_MS = parseInt(process.env.GMAIL_TRASH_BATCH_DELAY_MS, 10) || 250;

/**
 * Exponential backoff for Gmail API rate limits (429) and server errors (5xx).
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries
 */
async function withBackoff(fn, maxRetries = 5) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err?.response?.status || err?.code;
      const isRetryable = status === 429 || status === 500 || status === 503 || status === 'ECONNRESET';

      if (!isRetryable || attempt === maxRetries - 1) {
        throw err;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 32000);
      logger.warn(`Gmail API retry ${attempt + 1}/${maxRetries} after ${delay}ms`, { status, error: err.message });
      await sleep(delay);
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get an authenticated Gmail API client.
 * Passing expiry_date lets the googleapis library proactively refresh the
 * access token before it expires (critical for long-running scans).
 */
function getGmailClient(accessToken, refreshToken, tokenExpiry) {
  const auth = createAuthenticatedClient(accessToken, refreshToken, tokenExpiry);
  return google.gmail({ version: 'v1', auth });
}

/**
 * Fetch Gmail profile + storage quota
 * Returns: { emailAddress, messagesTotal, threadsTotal, historyId }
 * And from About: { storageUsed, storageLimit }
 */
async function getMailboxProfile(accessToken, refreshToken) {
  const gmail = getGmailClient(accessToken, refreshToken);

  const [profileRes, aboutRes] = await Promise.all([
    withBackoff(() => gmail.users.getProfile({ userId: 'me', fields: 'emailAddress,messagesTotal,threadsTotal,historyId' })),
    withBackoff(() => gmail.users.getProfile({ userId: 'me' })),
  ]);

  return {
    emailAddress: profileRes.data.emailAddress,
    messagesTotal: profileRes.data.messagesTotal,
    threadsTotal: profileRes.data.threadsTotal,
    historyId: profileRes.data.historyId,
  };
}

/**
 * Fetch storage quota from Google Drive API (shared quota)
 */
async function getStorageQuota(accessToken, refreshToken) {
  const auth = createAuthenticatedClient(accessToken, refreshToken);
  const drive = google.drive({ version: 'v3', auth });

  const res = await withBackoff(() =>
    drive.about.get({ fields: 'storageQuota' })
  );

  const quota = res.data.storageQuota;
  return {
    storageUsedBytes: Number(quota.usage) || 0,
    storageQuotaBytes: Number(quota.limit) || 0,
    driveUsedBytes: Number(quota.usageInDrive) || 0,
    gmailUsedBytes: Number(quota.usageInDriveTrash) || 0,
  };
}

/**
 * List messages matching a query.
 * ONLY fetches message IDs + metadata — never the body.
 * 
 * @param {object} gmail - Authenticated Gmail client
 * @param {string} q - Gmail search query
 * @param {string} pageToken - Pagination token
 * @param {number} maxResults - Max results per page (max 500)
 * @returns {{ messages: [{id, threadId}], nextPageToken }}
 */
async function listMessages(gmail, q, pageToken = null, maxResults = 500) {
  const params = {
    userId: 'me',
    q,
    maxResults,
    fields: 'messages(id,threadId),nextPageToken,resultSizeEstimate',
  };
  if (pageToken) params.pageToken = pageToken;

  const listStart = Date.now();
  const res = await withBackoff(() => gmail.users.messages.list(params));
  const elapsed = Date.now() - listStart;
  const estimate = res.data.resultSizeEstimate || 0;
  const count = (res.data.messages || []).length;
  logger.info(`[GMAIL DEBUG] messages.list: q="${q}", estimate=${estimate}, got=${count}, elapsed=${elapsed}ms`);
  return {
    messages: res.data.messages || [],
    nextPageToken: res.data.nextPageToken || null,
    resultSizeEstimate: estimate,
  };
}

/**
 * Collect message IDs for a Gmail query across all pages.
 * Optionally cap how many IDs are collected.
 *
 * @param {object} gmail
 * @param {string} q
 * @param {{ maxMessages?: number, pageDelayMs?: number }} options
 * @returns {Promise<string[]>}
 */
async function collectMessageIdsByQuery(gmail, q, options = {}) {
  const {
    maxMessages = Infinity,
    pageDelayMs = QUERY_PAGE_DELAY_MS,
  } = options;

  const ids = [];
  let pageToken = null;
  const limit = Number.isFinite(maxMessages) ? Math.max(0, Math.floor(maxMessages)) : Infinity;
  if (limit === 0) return ids;

  do {
    const { messages, nextPageToken } = await listMessages(gmail, q, pageToken, 500);
    ids.push(...messages.map(m => m.id));
    pageToken = nextPageToken;

    if (ids.length >= limit) {
      break;
    }

    if (pageToken) {
      await sleep(pageDelayMs);
    }
  } while (pageToken);

  return Number.isFinite(limit) ? ids.slice(0, limit) : ids;
}

/**
 * Fetch minimal message metadata (no body).
 * Returns: id, threadId, labelIds, sizeEstimate, internalDate, headers subset
 * 
 * @param {object} gmail - Authenticated Gmail client
 * @param {string} messageId
 */
async function getMessageMetadata(gmail, messageId) {
  await sleep(GMAIL_RATE_LIMIT_DELAY);

  const res = await withBackoff(() =>
    gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe'],
      fields: 'id,threadId,labelIds,sizeEstimate,internalDate,snippet,payload/headers,payload/mimeType',
    })
  );

  const msg = res.data;
  const headers = (msg.payload?.headers || []).reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {});

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    sizeEstimate: msg.sizeEstimate || 0,
    internalDate: Number(msg.internalDate) || 0,
    from: headers['from'] || '',
    subject: headers['subject'] || '',
    date: headers['date'] || '',
    mimeType: msg.payload?.mimeType || '',
    snippet: msg.snippet || '',
    listUnsubscribe: headers['list-unsubscribe'] || '',
  };
}

/**
 * Fetch metadata for a batch of messages using parallel requests with throttling.
 * Handles up to 500 IDs per call.
 */

function getBatchModifyAction(action = 'auto_delete') {
  const normalized = String(action || 'auto_delete').toLowerCase();
  if (normalized === 'archive') {
    return { addLabelIds: [], removeLabelIds: ['INBOX'] };
  }
  if (normalized === 'spam') {
    return { addLabelIds: ['SPAM'], removeLabelIds: ['INBOX'] };
  }
  return { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX', 'UNREAD'] };
}

async function applyActionToMessages(gmail, messageIds, action = 'auto_delete', onProgress = null) {
  const BATCH_SIZE = 500;
  const ids = Array.isArray(messageIds) ? messageIds : [];
  const results = { success: [], failed: [] };
  const total = ids.length;
  if (!ids.length) return results;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const labelAction = getBatchModifyAction(action);
    try {
      await withBackoff(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            addLabelIds: labelAction.addLabelIds,
            removeLabelIds: labelAction.removeLabelIds,
          },
        })
      );
      results.success.push(...batch);
    } catch (err) {
      logger.error('applyActionToMessages failed for batch', err, { batchSize: batch.length, action });
      results.failed.push(...batch);
    }

    if (typeof onProgress === 'function') {
      await onProgress({ movedCount: results.success.length, failedCount: results.failed.length, totalCount: total });
    }

    if (i + BATCH_SIZE < ids.length) await sleep(TRASH_BATCH_DELAY_MS);
  }

  return results;
}

async function createOrUpdateSenderFilter(gmail, senderEmail, action = 'auto_delete') {
  const criteria = { from: senderEmail };
  const labelAction = getBatchModifyAction(action);
  try {
    const res = await withBackoff(() =>
      gmail.users.settings.filters.create({
        userId: 'me',
        requestBody: {
          criteria,
          action: labelAction,
        },
      })
    );
    return { created: true, filterId: res.data?.id || null, duplicate: false };
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || '';
    if (/already exists|duplicate|exists/i.test(message)) {
      return { created: false, duplicate: true, filterId: null };
    }
    throw err;
  }
}

async function attemptUnsubscribe(unsubscribeLink) {
  const raw = String(unsubscribeLink || '').trim();
  if (!raw) return { ok: false, reason: 'missing_link' };

  const cleaned = raw.split(',').map(v => v.trim().replace(/^<|>$/g, '')).find(Boolean) || '';
  if (!cleaned) return { ok: false, reason: 'missing_link' };
  if (cleaned.toLowerCase().startsWith('mailto:')) {
    return { ok: false, reason: 'mailto_not_supported' };
  }

  try {
    const res = await fetch(cleaned, { method: 'GET', redirect: 'follow' });
    return { ok: res.ok, status: res.status, reason: res.ok ? null : 'http_failed' };
  } catch (err) {
    return { ok: false, reason: err.message || 'request_failed' };
  }
}

async function batchGetMessageMetadata(gmail, messageIds) {
  const BATCH_SIZE = 50;
  const results = [];

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(id => getMessageMetadata(gmail, id))
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        logger.warn('Failed to fetch message metadata', { error: result.reason?.message });
      }
    }

    // Throttle between batches
    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(500);
    }
  }

  return results;
}

/**
 * Move messages to Trash using batchModify.
 * Gmail batchModify supports up to 1000 IDs per call.
 * 
 * @param {object} gmail - Authenticated Gmail client
 * @param {string[]} messageIds
 */
async function batchTrashMessages(gmail, messageIds, onProgress = null) {
  const BATCH_SIZE = 500;
  const results = { success: [], failed: [] };
  const total = messageIds.length;

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);

    try {
      await withBackoff(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            addLabelIds: ['TRASH'],
            removeLabelIds: ['INBOX', 'UNREAD'],
          },
        })
      );
      results.success.push(...batch);
    } catch (err) {
      logger.error('batchModify failed for batch', err, { batchSize: batch.length });
      // Retry failed large batches in smaller chunks for transient partial failures.
      const retryChunks = [];
      for (let j = 0; j < batch.length; j += 50) {
        retryChunks.push(batch.slice(j, j + 50));
      }

      for (const retryChunk of retryChunks) {
        try {
          await withBackoff(() =>
            gmail.users.messages.batchModify({
              userId: 'me',
              requestBody: {
                ids: retryChunk,
                addLabelIds: ['TRASH'],
                removeLabelIds: ['INBOX', 'UNREAD'],
              },
            })
          );
          results.success.push(...retryChunk);
        } catch (retryErr) {
          logger.error('batchModify retry failed', retryErr, { batchSize: retryChunk.length });
          results.failed.push(...retryChunk);
        }
      }
    }

    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(TRASH_BATCH_DELAY_MS);
    }

    if (typeof onProgress === 'function') {
      await onProgress({
        movedCount: results.success.length,
        failedCount: results.failed.length,
        totalCount: total,
        movedIds: results.success,
      });
    }
  }

  return results;
}

/**
 * Count query matches by traversing pages (more reliable than resultSizeEstimate).
 * Returns a lower-bound when maxCount is reached before traversal completes.
 */
async function countMessagesByQuery(gmail, q, options = {}) {
  const {
    maxCount = 5000,
    pageDelayMs = 150,
  } = options;

  let count = 0;
  let pageToken = null;
  let hasMore = false;

  do {
    const { messages, nextPageToken } = await listMessages(gmail, q, pageToken, 500);
    count += (messages || []).length;
    pageToken = nextPageToken;

    if (count >= maxCount) {
      hasMore = !!pageToken;
      return { count: maxCount, isLowerBound: hasMore };
    }

    if (pageToken) {
      await sleep(pageDelayMs);
    }
  } while (pageToken);

  return { count, isLowerBound: false };
}

/**
 * Get an approximate total count of messages currently in Trash.
 */
async function getTrashEstimate(gmail) {
  const res = await withBackoff(() =>
    gmail.users.messages.list({
      userId: 'me',
      q: 'in:trash',
      maxResults: 1,
      fields: 'resultSizeEstimate',
    })
  );
  return Number(res.data?.resultSizeEstimate || 0);
}

/**
 * Get an approximate total count of conversations currently in Trash.
 */
async function getTrashConversationEstimate(gmail) {
  const res = await withBackoff(() =>
    gmail.users.threads.list({
      userId: 'me',
      q: 'in:trash',
      maxResults: 1,
      fields: 'resultSizeEstimate',
    })
  );
  return Number(res.data?.resultSizeEstimate || 0);
}

/**
 * Restore messages from Trash (undo cleanup).
 * Removes TRASH label.
 */
async function batchRestoreMessages(gmail, messageIds) {
  const BATCH_SIZE = 500;
  const results = { success: [], failed: [] };

  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);

    try {
      await withBackoff(() =>
        gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            removeLabelIds: ['TRASH'],
          },
        })
      );
      results.success.push(...batch);
    } catch (err) {
      logger.error('batchModify restore failed', err, { batchSize: batch.length });
      results.failed.push(...batch);
    }

    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(1000);
    }
  }

  return results;
}

/**
 * Restore messages from Trash and re-apply their original labels.
 * labelsByMessageId shape: { [messageId]: string[] }
 */
async function batchRestoreMessagesWithLabels(gmail, messageIds, labelsByMessageId = {}) {
  const BATCH_SIZE = 500;
  const results = { success: [], failed: [] };
  const NON_RESTORABLE_LABELS = new Set(['TRASH', 'DRAFT']);

  // Group message IDs by identical label set so we can use batchModify efficiently.
  const grouped = new Map();
  for (const id of messageIds) {
    const labels = Array.from(new Set((labelsByMessageId[id] || []).filter(Boolean)))
      .filter(l => !NON_RESTORABLE_LABELS.has(l))
      .sort();
    const key = labels.join(',');
    if (!grouped.has(key)) grouped.set(key, { ids: [], labels });
    grouped.get(key).ids.push(id);
  }

  for (const { ids, labels } of grouped.values()) {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);

      try {
        await withBackoff(() =>
          gmail.users.messages.batchModify({
            userId: 'me',
            requestBody: {
              ids: batch,
              removeLabelIds: ['TRASH'],
              addLabelIds: labels,
            },
          })
        );
        results.success.push(...batch);
      } catch (err) {
        // If some labels are no longer valid (for example DRAFT), still restore from Trash.
        const message = err?.response?.data?.error?.message || err?.message || '';
        if (/Invalid label/i.test(message)) {
          logger.warn('restore-with-labels had invalid labels; retrying without addLabelIds', {
            batchSize: batch.length,
            error: message,
          });
          try {
            await withBackoff(() =>
              gmail.users.messages.batchModify({
                userId: 'me',
                requestBody: {
                  ids: batch,
                  removeLabelIds: ['TRASH'],
                },
              })
            );
            results.success.push(...batch);
            continue;
          } catch (fallbackErr) {
            logger.error('fallback restore failed', fallbackErr, { batchSize: batch.length });
          }
        } else {
          logger.error('batchModify restore-with-labels failed', err, { batchSize: batch.length });
        }
        results.failed.push(...batch);
      }

      if (i + BATCH_SIZE < ids.length) {
        await sleep(1000);
      }
    }
  }

  return results;
}

/**
 * Check if a thread has replies (thread message count > 1)
 */
async function getThreadMessageCount(gmail, threadId) {
  try {
    const res = await withBackoff(() =>
      gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        fields: 'messages/id',
      })
    );
    return (res.data.messages || []).length;
  } catch {
    return 1;
  }
}

module.exports = {
  getGmailClient,
  getMailboxProfile,
  getStorageQuota,
  listMessages,
  collectMessageIdsByQuery,
  countMessagesByQuery,
  getTrashEstimate,
  getTrashConversationEstimate,
  getMessageMetadata,
  batchGetMessageMetadata,
  batchTrashMessages,
  batchRestoreMessages,
  batchRestoreMessagesWithLabels,
  applyActionToMessages,
  createOrUpdateSenderFilter,
  attemptUnsubscribe,
  getThreadMessageCount,
  withBackoff,
  sleep,
};
