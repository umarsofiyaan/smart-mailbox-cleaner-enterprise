// src/services/cleanupService.js
// Handles bulk email cleanup (move to Trash) and undo.

const {
  getGmailClient,
  batchGetMessageMetadata,
  batchTrashMessages,
  batchRestoreMessages,
  batchRestoreMessagesWithLabels,
  applyActionToMessages,
} = require('./gmailService');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const LABEL_SNAPSHOT_LIMIT = parseInt(process.env.CLEANUP_LABEL_SNAPSHOT_LIMIT, 10) || 2000;

function extractSenderEmail(from = '') {
  const raw = String(from || '').trim().toLowerCase();
  const m = raw.match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).replace(/^"|"$/g, '').trim();
  return email.includes('@') ? email : '';
}

async function applyBlockedSenderRules(userId, gmail, messageIds = []) {
  if (!userId || !Array.isArray(messageIds) || !messageIds.length) {
    return { handledIds: [], trashedIds: [], applied: [] };
  }

  const rulesRes = await query(
    `SELECT sender_email, action
     FROM blocked_senders
     WHERE user_id = $1`,
    [userId]
  );
  if (!rulesRes.rows.length) return { handledIds: [], trashedIds: [], applied: [] };

  const ruleMap = new Map();
  for (const row of rulesRes.rows) {
    ruleMap.set(String(row.sender_email || '').toLowerCase(), String(row.action || 'auto_delete').toLowerCase());
  }

  const metadata = await batchGetMessageMetadata(gmail, messageIds);
  const groupedByAction = new Map();

  for (const msg of metadata) {
    const sender = extractSenderEmail(msg.from);
    const action = ruleMap.get(sender);
    if (!action) continue;
    if (!groupedByAction.has(action)) groupedByAction.set(action, []);
    groupedByAction.get(action).push(msg.id);
  }

  const handled = new Set();
  const trashed = new Set();
  const applied = [];
  for (const [action, ids] of groupedByAction.entries()) {
    const uniq = Array.from(new Set(ids));
    if (!uniq.length) continue;
    const res = await applyActionToMessages(gmail, uniq, action);
    for (const id of res.success) {
      handled.add(id);
      if (action === 'auto_delete') trashed.add(id);
    }
    applied.push({ action, success: res.success.length, failed: res.failed.length });
  }

  return {
    handledIds: Array.from(handled),
    trashedIds: Array.from(trashed),
    applied,
  };
}

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
    // message_count tracks moved/restorable message count, so start at 0.
    [userId, scanId, mailboxId, category, [], estimatedBytes, 0]
  );

  return actionResult.rows[0];
}

async function runCleanupAction(
  actionId,
  messageIds,
  estimatedBytes,
  tokens,
  tokenExpiry = null,
  onProgress = null,
  options = {},
  userId = null
) {
  if (!messageIds || messageIds.length === 0) throw new Error('No message IDs provided.');

  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokenExpiry);
  const shouldSnapshotLabels = options.snapshotLabels !== false;
  const shouldLoadMetadata = shouldSnapshotLabels && messageIds.length <= LABEL_SNAPSHOT_LIMIT;
  const metadata = shouldLoadMetadata ? await batchGetMessageMetadata(gmail, messageIds) : [];

  const blockedRuleResult = await applyBlockedSenderRules(userId, gmail, messageIds)
    .catch(() => ({ handledIds: [], trashedIds: [], applied: [] }));
  const handledSet = new Set(blockedRuleResult.handledIds || []);
  const remainingIds = messageIds.filter((id) => !handledSet.has(id));

  const result = await batchTrashMessages(gmail, remainingIds, async (progress) => {
    const partialMovedIds = Array.from(new Set([...(progress.movedIds || []), ...(blockedRuleResult.trashedIds || [])]));
    await query(
      `UPDATE cleanup_actions
       SET message_count = $1,
           message_ids = $2
       WHERE id = $3 AND status = 'pending'`,
      [partialMovedIds.length, partialMovedIds, actionId]
    );

    if (typeof onProgress === 'function') {
      await onProgress(progress);
    }
  });

  const trashedIds = Array.from(new Set([...(result.success || []), ...(blockedRuleResult.trashedIds || [])]));

  await query(
    `UPDATE cleanup_actions
     SET status = 'complete', message_ids = $1, message_count = $2
     WHERE id = $3`,
    [trashedIds, trashedIds.length, actionId]
  );

  if (shouldLoadMetadata) {
    await snapshotOriginalLabels(actionId, metadata, result.success);
  }

  const successfulSet = new Set(result.success);
  const conversationCount = shouldLoadMetadata
    ? new Set(
        metadata
          .filter((m) => successfulSet.has(m.id))
          .map((m) => m.threadId)
          .filter(Boolean)
      ).size
    : 0;

  const undoExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    actionId,
    successCount: trashedIds.length,
    conversationCount,
    failedCount: result.failed.length,
    failedIds: result.failed,
    bytesFreed: estimatedBytes,
    undoExpiresAt,
    usedFastMode: !shouldLoadMetadata,
  };
}

async function executeCleanup(userId, scanId, category, messageIds, estimatedBytes, tokens) {
  if (!messageIds || messageIds.length === 0) throw new Error('No message IDs provided.');

  logger.info('Starting cleanup', { userId, category, messageCount: messageIds.length });
  const action = await createCleanupAction(userId, scanId, category, estimatedBytes, messageIds.length);

  try {
    const result = await runCleanupAction(
      action.id,
      messageIds,
      estimatedBytes,
      tokens,
      tokens.tokenExpiry,
      null,
      {},
      userId
    );
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

  const latestJob = await query(
    `SELECT status
     FROM jobs
     WHERE user_id = $1
       AND job_type = 'CLEANUP'
       AND COALESCE(payload->>'actionId', '') = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, actionId]
  );
  const latestJobStatus = latestJob.rows[0]?.status || null;

  const isRecoverableStatus = ['complete', 'failed', 'pending'].includes(action.status);
  if (!isRecoverableStatus) {
    throw new Error('This cleanup cannot be restored.');
  }
  if (latestJobStatus === 'queued' || latestJobStatus === 'running') {
    throw new Error('Cleanup is still running. Please retry restore in a minute.');
  }
  if (!Array.isArray(action.message_ids) || action.message_ids.length === 0) {
    throw new Error('No moved emails found to restore for this cleanup.');
  }

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
              executed_at, undone_at, expires_at, error_message,
              COALESCE(array_length(message_ids, 1), 0) AS moved_snapshot_count
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
      `SELECT payload, status
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
      const progress = payload.progress || {};
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
        progressStage: progress.stage || null,
        progressMatchedCount: Number(progress.matchedCount || 0),
        progressMovedCount: Number(progress.movedCount || 0),
        progressFailedCount: Number(progress.failedCount || 0),
        progressTotalCount: Number(progress.totalCount || 0),
        usedFastMode: !!result.usedFastMode,
        jobStatus: row.status || null,
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
      recoverableMovedCount: Number(row.moved_snapshot_count || 0),
      canUndo:
        ['complete', 'failed', 'pending'].includes(row.status)
        && Number(row.moved_snapshot_count || 0) > 0
        && (jobMetaByAction.get(row.id)?.jobStatus !== 'running' && jobMetaByAction.get(row.id)?.jobStatus !== 'queued')
        && new Date(row.expires_at) > new Date(),
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
