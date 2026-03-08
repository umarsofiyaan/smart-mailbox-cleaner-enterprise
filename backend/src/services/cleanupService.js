// src/services/cleanupService.js
// Handles bulk email cleanup (move to Trash) and undo.

const {
  getGmailClient,
  batchGetMessageMetadata,
  batchTrashMessages,
  batchRestoreMessages,
  batchRestoreMessagesWithLabels,
} = require('./gmailService');
const { query } = require('../config/database');
const logger = require('../utils/logger');

async function snapshotOriginalLabels(actionId, metadata, successfulIds) {
  if (!metadata?.length || !successfulIds?.length) return;

  const successfulSet = new Set(successfulIds);
  const rows = metadata
    .filter(m => successfulSet.has(m.id))
    .map(m => ({
      messageId: m.id,
      labelIds: Array.isArray(m.labelIds) ? m.labelIds : [],
    }));

  if (!rows.length) return;

  for (let i = 0; i < rows.length; i += 300) {
    const batch = rows.slice(i, i + 300);
    const values = [];
    const params = [];
    let p = 1;

    for (const row of batch) {
      values.push(`($${p++}::uuid, $${p++}::text, $${p++}::text[])`);
      params.push(actionId, row.messageId, row.labelIds);
    }

    try {
      await query(
        `INSERT INTO message_original_labels (action_id, message_id, label_ids)
         VALUES ${values.join(',')}`,
        params
      );
    } catch (err) {
      logger.warn('Skipping original-label snapshot insert', { actionId, error: err.message });
      return;
    }
  }
}

async function loadOriginalLabelsMap(actionId) {
  try {
    const res = await query(
      `SELECT message_id, label_ids
       FROM message_original_labels
       WHERE action_id = $1`,
      [actionId]
    );

    const map = {};
    for (const row of res.rows) {
      map[row.message_id] = Array.isArray(row.label_ids) ? row.label_ids : [];
    }
    return map;
  } catch (err) {
    logger.warn('Could not load original labels for undo; using basic restore', {
      actionId,
      error: err.message,
    });
    return null;
  }
}

async function createCleanupAction(
  userId,
  scanId,
  category,
  estimatedBytes = 0,
  expectedMessageCount = 0,
  mailboxId = null
) {
  const actionResult = await query(
    `INSERT INTO cleanup_actions
       (user_id, scan_id, mailbox_id, category, message_ids, status, bytes_freed, message_count)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
     RETURNING id`,
    [userId, scanId, mailboxId, category, [], estimatedBytes, expectedMessageCount]
  );
  return actionResult.rows[0];
}

async function runCleanupAction(actionId, messageIds, estimatedBytes, tokens, tokenExpiry = null, onProgress = null) {
  if (!messageIds || messageIds.length === 0) throw new Error('No message IDs provided.');

  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokenExpiry);
  const metadata = await batchGetMessageMetadata(gmail, messageIds);
  const result = await batchTrashMessages(gmail, messageIds, async (progress) => {
    await query(
      `UPDATE cleanup_actions
       SET message_count = $1
       WHERE id = $2 AND status = 'pending'`,
      [progress.movedCount, actionId]
    );

    if (typeof onProgress === 'function') {
      await onProgress(progress);
    }
  });

  await query(
    `UPDATE cleanup_actions
     SET status = 'complete', message_ids = $1, message_count = $2
     WHERE id = $3`,
    [result.success, result.success.length, actionId]
  );

  await snapshotOriginalLabels(actionId, metadata, result.success);

  const successfulSet = new Set(result.success);
  const conversationCount = new Set(
    metadata
      .filter((m) => successfulSet.has(m.id))
      .map((m) => m.threadId)
      .filter(Boolean)
  ).size;

  const undoExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    actionId,
    successCount: result.success.length,
    conversationCount,
    failedCount: result.failed.length,
    failedIds: result.failed,
    bytesFreed: estimatedBytes,
    undoExpiresAt,
  };
}

async function executeCleanup(userId, scanId, category, messageIds, estimatedBytes, tokens) {
  if (!messageIds || messageIds.length === 0) throw new Error('No message IDs provided.');

  logger.info('Starting cleanup', { userId, category, messageCount: messageIds.length });
  const action = await createCleanupAction(userId, scanId, category, estimatedBytes, messageIds.length);

  try {
    const result = await runCleanupAction(action.id, messageIds, estimatedBytes, tokens, tokens.tokenExpiry);
    logger.info('Cleanup complete', { actionId: result.actionId, successCount: result.successCount });
    return result;
  } catch (err) {
    await query(
      "UPDATE cleanup_actions SET status = 'failed', error_message = $1 WHERE id = $2",
      [err.message, action.id]
    );
    logger.error('Cleanup failed', err, { actionId: action.id });
    throw err;
  }
}

async function undoCleanup(actionId, userId, tokens) {
  const actionResult = await query(
    `SELECT id, user_id, message_ids, status, expires_at, category
     FROM cleanup_actions WHERE id = $1`,
    [actionId]
  );

  if (actionResult.rows.length === 0) throw new Error('Cleanup action not found.');
  const action = actionResult.rows[0];

  if (action.user_id !== userId) throw new Error('Unauthorized: This action does not belong to you.');
  if (action.status === 'undone') {
    return { actionId, successCount: 0, failedCount: 0, alreadyUndone: true };
  }
  if (action.status !== 'complete') throw new Error('Only completed cleanups can be undone.');
  if (new Date(action.expires_at) < new Date()) {
    throw new Error('Undo window has expired (30 days).');
  }

  logger.info('Starting undo', { actionId, userId, category: action.category });

  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);
  const labelsByMessageId = await loadOriginalLabelsMap(actionId);
  const result = labelsByMessageId
    ? await batchRestoreMessagesWithLabels(gmail, action.message_ids, labelsByMessageId)
    : await batchRestoreMessages(gmail, action.message_ids);

  if (result.failed.length === 0) {
    await query(
      "UPDATE cleanup_actions SET status = 'undone', undone_at = NOW(), error_message = NULL WHERE id = $1",
      [actionId]
    );
  } else {
    // Keep action in complete state so user can retry Undo for remaining IDs.
    await query(
      `UPDATE cleanup_actions
       SET status = 'complete',
           undone_at = NULL,
           error_message = $2
       WHERE id = $1`,
      [actionId, `Undo partially completed. Restored ${result.success.length}, failed ${result.failed.length}.`]
    );
  }

  logger.info('Undo complete', {
    actionId,
    successCount: result.success.length,
    failedCount: result.failed.length,
  });
  return {
    actionId,
    successCount: result.success.length,
    failedCount: result.failed.length,
    isPartial: result.failed.length > 0,
  };
}

async function getCleanupHistory(userId, limit = 10, offset = 0) {
  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10), 100);
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, category, status, message_count, bytes_freed,
              executed_at, undone_at, expires_at, error_message
       FROM cleanup_actions
       WHERE user_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    ),
    query('SELECT COUNT(*) FROM cleanup_actions WHERE user_id = $1', [userId]),
  ]);

  const total = parseInt(count.rows[0].count, 10);
  const actionIds = data.rows.map(r => r.id);

  const jobMetaByAction = new Map();
  if (actionIds.length > 0) {
    const jobs = await query(
      `SELECT payload
       FROM jobs
       WHERE user_id = $1
         AND job_type = 'CLEANUP'
         AND (payload->>'actionId') = ANY($2::text[])
       ORDER BY created_at DESC`,
      [userId, actionIds]
    );

    for (const row of jobs.rows) {
      const payload = row.payload || {};
      const actionId = payload.actionId;
      if (!actionId || jobMetaByAction.has(actionId)) continue;
      const result = payload.result || {};
      jobMetaByAction.set(actionId, {
        processedCount: Number(result.processedCount || 0),
        movedCount: Number(result.successCount || 0),
        conversationCount: Number(result.conversationCount || 0),
        sourceQuery: result.sourceQuery || null,
        failedCount: Number(result.failedCount || 0),
        trashBeforeEstimate: Number(result.trashBeforeEstimate || 0),
        trashAfterEstimate: Number(result.trashAfterEstimate || 0),
        estimatedNewInTrash: Number(result.estimatedNewInTrash || 0),
        trashConversationsBefore: Number(result.trashConversationsBefore || 0),
        trashConversationsAfter: Number(result.trashConversationsAfter || 0),
        estimatedNewConversationsInTrash: Number(result.estimatedNewConversationsInTrash || 0),
      });
    }
  }

  return {
    items: data.rows.map(row => ({
      ...(jobMetaByAction.get(row.id) || {}),
      id: row.id,
      category: row.category,
      status: row.status,
      messageCount: row.message_count,
      bytesFreed: row.bytes_freed,
      executedAt: row.executed_at,
      undoneAt: row.undone_at,
      expiresAt: row.expires_at,
      errorMessage: row.error_message || null,
      canUndo: row.status === 'complete' && new Date(row.expires_at) > new Date(),
    })),
    total,
    limit: safeLimit,
    offset: safeOffset,
    hasMore: safeOffset + safeLimit < total,
  };
}

module.exports = {
  executeCleanup,
  createCleanupAction,
  runCleanupAction,
  undoCleanup,
  getCleanupHistory,
};
