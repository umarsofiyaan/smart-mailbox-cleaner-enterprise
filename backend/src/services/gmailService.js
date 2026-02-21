// src/services/gmailService.js
// All Gmail API interactions. NEVER fetches or stores email body content.
const { google } = require('googleapis');
const { createAuthenticatedClient } = require('../config/google');
const logger = require('../utils/logger');

const GMAIL_RATE_LIMIT_DELAY = parseInt(process.env.GMAIL_RATE_LIMIT_DELAY_MS) || 100;

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
 * Get an authenticated Gmail API client
 */
function getGmailClient(accessToken, refreshToken) {
  const auth = createAuthenticatedClient(accessToken, refreshToken);
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

  const res = await withBackoff(() => gmail.users.messages.list(params));
  return {
    messages: res.data.messages || [],
    nextPageToken: res.data.nextPageToken || null,
    resultSizeEstimate: res.data.resultSizeEstimate || 0,
  };
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
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      fields: 'id,threadId,labelIds,sizeEstimate,internalDate,payload/headers,payload/mimeType',
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
  };
}

/**
 * Fetch metadata for a batch of messages using parallel requests with throttling.
 * Handles up to 500 IDs per call.
 */
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
async function batchTrashMessages(gmail, messageIds) {
  const BATCH_SIZE = 1000;
  const results = { success: [], failed: [] };

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
      results.failed.push(...batch);
    }

    if (i + BATCH_SIZE < messageIds.length) {
      await sleep(1000);
    }
  }

  return results;
}

/**
 * Restore messages from Trash (undo cleanup).
 * Removes TRASH label.
 */
async function batchRestoreMessages(gmail, messageIds) {
  const BATCH_SIZE = 1000;
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
  getMessageMetadata,
  batchGetMessageMetadata,
  batchTrashMessages,
  batchRestoreMessages,
  getThreadMessageCount,
  withBackoff,
  sleep,
};
