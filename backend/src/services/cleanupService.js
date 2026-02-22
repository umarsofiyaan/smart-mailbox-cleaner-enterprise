// src/services/cleanupService.js
// Handles bulk email cleanup (move to Trash) and undo.
// Round 3: receipt email on execute + pagination in getCleanupHistory

const { getGmailClient, batchTrashMessages, batchRestoreMessages } = require('./gmailService');
const { query } = require('../config/database');
const logger = require('../utils/logger');

async function executeCleanup(userId, scanId, category, messageIds, estimatedBytes, tokens) {
  if (!messageIds || messageIds.length === 0) throw new Error('No message IDs provided.');
  if (messageIds.length > 5000) throw new Error('Maximum 5000 messages per cleanup action.');

  logger.info('Starting cleanup', { userId, category, messageCount: messageIds.length });

  const actionResult = await query(
    `INSERT INTO cleanup_actions
       (user_id, scan_id, category, message_ids, status, bytes_freed, message_count)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING id`,
    [userId, scanId, category, messageIds, estimatedBytes, messageIds.length]
  );
  const actionId = actionResult.rows[0].id;

  try {
    const gmail  = getGmailClient(tokens.accessToken, tokens.refreshToken);
    const result = await batchTrashMessages(gmail, messageIds);

    await query(
      `UPDATE cleanup_actions
       SET status = 'complete', message_ids = $1, message_count = $2
       WHERE id = $3`,
      [result.success, result.success.length, actionId]
    );

    const undoExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    logger.info('Cleanup complete', { actionId, successCount: result.success.length });

    // Receipt email — fire-and-forget, never blocks the response
    query('SELECT email, display_name FROM users WHERE id = $1', [userId])
      .then(res => {
        if (res.rows[0] && result.success.length > 0) {
          const { sendCleanupReceipt } = require('./emailService');
          sendCleanupReceipt(res.rows[0].email, res.rows[0].display_name, {
            category, messageCount: result.success.length,
            bytesFreed: estimatedBytes, undoExpiresAt,
          });
        }
      })
      .catch(err => logger.warn('Receipt email error', { error: err.message }));

    return {
      actionId,
      successCount: result.success.length,
      failedCount:  result.failed.length,
      failedIds:    result.failed,
      bytesFreed:   estimatedBytes,
      undoExpiresAt,
    };

  } catch (err) {
    await query(
      "UPDATE cleanup_actions SET status = 'failed', error_message = $1 WHERE id = $2",
      [err.message, actionId]
    );
    logger.error('Cleanup failed', err, { actionId });
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

  if (action.user_id !== userId)    throw new Error('Unauthorized: This action does not belong to you.');
  if (action.status === 'undone')   throw new Error('This cleanup has already been undone.');
  if (action.status !== 'complete') throw new Error('Only completed cleanups can be undone.');
  if (new Date(action.expires_at) < new Date()) {
    throw new Error('Undo window has expired (30 days).');
  }

  logger.info('Starting undo', { actionId, userId, category: action.category });

  const gmail  = getGmailClient(tokens.accessToken, tokens.refreshToken);
  const result = await batchRestoreMessages(gmail, action.message_ids);

  await query("UPDATE cleanup_actions SET status = 'undone', undone_at = NOW() WHERE id = $1", [actionId]);

  logger.info('Undo complete', { actionId, successCount: result.success.length });
  return { actionId, successCount: result.success.length, failedCount: result.failed.length };
}

// Paginated history — limit/offset, returns { items, total, hasMore }
async function getCleanupHistory(userId, limit = 10, offset = 0) {
  const safeLimit  = Math.min(Math.max(1, parseInt(limit)  || 10), 100);
  const safeOffset = Math.max(0, parseInt(offset) || 0);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, category, status, message_count, bytes_freed,
              executed_at, undone_at, expires_at
       FROM cleanup_actions
       WHERE user_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    ),
    query('SELECT COUNT(*) FROM cleanup_actions WHERE user_id = $1', [userId]),
  ]);

  const total = parseInt(count.rows[0].count);

  return {
    items: data.rows.map(row => ({
      id:           row.id,
      category:     row.category,
      status:       row.status,
      messageCount: row.message_count,
      bytesFreed:   row.bytes_freed,
      executedAt:   row.executed_at,
      undoneAt:     row.undone_at,
      expiresAt:    row.expires_at,
      canUndo: row.status === 'complete' && new Date(row.expires_at) > new Date(),
    })),
    total,
    limit:   safeLimit,
    offset:  safeOffset,
    hasMore: safeOffset + safeLimit < total,
  };
}

module.exports = { executeCleanup, undoCleanup, getCleanupHistory };
