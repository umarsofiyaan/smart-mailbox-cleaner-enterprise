// src/routes/cleanup.js
const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { requirePro } = require('../middleware/requirePro');
const { cleanupLimiter } = require('../middleware/security');
const { getOAuthTokens } = require('../services/tokenService');
const { executeCleanup, undoCleanup, getCleanupHistory } = require('../services/cleanupService');
const { checkQuota, consumeQuota, getQuotaSummary } = require('../services/quotaService');
const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * POST /cleanup/execute
 * Execute bulk cleanup for a category (Pro only).
 * Moves emails to Trash — NEVER permanent delete.
 * Enforces free-tier quota for non-Pro users.
 * 
 * Body: { scanId, category, messageIds, estimatedBytes }
 */
router.post(
  '/execute',
  requireAuth,         // ← requirePro removed: free users can now use quota
  cleanupLimiter,
  [
    body('scanId').isUUID().withMessage('Valid scanId required.'),
    body('category').isString().isLength({ min: 1, max: 100 }).withMessage('Category required.'),
    body('messageIds').isArray({ min: 1, max: 5000 }).withMessage('messageIds must be an array of 1-5000 IDs.'),
    body('messageIds.*').isString().withMessage('Each message ID must be a string.'),
    body('estimatedBytes').isInt({ min: 0 }).withMessage('estimatedBytes must be a non-negative integer.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { scanId, category, messageIds, estimatedBytes } = req.body;
    const userId = req.user.id;

    // Verify scan belongs to user
    const scanCheck = await query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );

    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found or does not belong to you.' });
    }

    // Check quota — Pro users get unlimited, free users capped
    const quotaCheck = await checkQuota(userId);
    if (!quotaCheck.allowed) {
      return res.status(403).json({
        error: quotaCheck.reason,
        code: 'QUOTA_EXHAUSTED',
        upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
      });
    }

    // Cap to available quota (Infinity for Pro, remaining count for free)
    const effectiveMessageCount = Math.min(messageIds.length, quotaCheck.remaining);
    if (effectiveMessageCount < messageIds.length) {
      // Trim message IDs to match quota
      messageIds.length = effectiveMessageCount;
    }

    try {
      const tokens = await getOAuthTokens(userId);
      const result = await executeCleanup(userId, scanId, category, messageIds, estimatedBytes, tokens);

      // Consume quota after successful cleanup
      await consumeQuota(userId, result.successCount);

      return res.json({
        success: true,
        actionId: result.actionId,
        successCount: result.successCount,
        failedCount: result.failedCount,
        bytesFreed: result.bytesFreed,
        bytesFreedMB: parseFloat((result.bytesFreed / (1024 * 1024)).toFixed(2)),
        undoExpiresAt: result.undoExpiresAt,
        message: `${result.successCount} emails moved to Trash. You have 30 days to undo this action.`,
        quotaRemaining: quotaCheck.remaining - result.successCount,
      });

    } catch (err) {
      logger.error('Cleanup execute failed', err, { userId, category });
      return res.status(500).json({ error: err.message || 'Cleanup failed.' });
    }
  }
);

/**
 * POST /cleanup/undo/:actionId
 * Restore trashed emails (undo cleanup).
 * Available within 30 days.
 */
router.post(
  '/undo/:actionId',
  requireAuth,
  [param('actionId').isUUID().withMessage('Valid actionId required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { actionId } = req.params;
    const userId = req.user.id;

    try {
      const tokens = await getOAuthTokens(userId);
      const result = await undoCleanup(actionId, userId, tokens);

      return res.json({
        success: true,
        actionId,
        restoredCount: result.successCount,
        failedCount: result.failedCount,
        message: `${result.successCount} emails restored from Trash.`,
      });

    } catch (err) {
      logger.warn('Undo failed', { actionId, userId, error: err.message });
      return res.status(400).json({ error: err.message });
    }
  }
);

/**
 * GET /cleanup/history
 * List recent cleanup actions with undo eligibility.
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    const history = await getCleanupHistory(req.user.id);
    return res.json({ history });
  } catch (err) {
    logger.error('Failed to fetch cleanup history', err);
    return res.status(500).json({ error: 'Failed to fetch history.' });
  }
});

/**
 * GET /cleanup/action/:actionId
 * Get details of a specific cleanup action.
 */
router.get('/action/:actionId', requireAuth, async (req, res) => {
  const { actionId } = req.params;

  const result = await query(
    `SELECT id, category, status, message_count, bytes_freed,
            executed_at, undone_at, expires_at
     FROM cleanup_actions
     WHERE id = $1 AND user_id = $2`,
    [actionId, req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Action not found.' });
  }

  const action = result.rows[0];
  return res.json({
    id: action.id,
    category: action.category,
    status: action.status,
    messageCount: action.message_count,
    bytesFreed: action.bytes_freed,
    bytesFreedMB: parseFloat((action.bytes_freed / (1024 * 1024)).toFixed(2)),
    executedAt: action.executed_at,
    undoneAt: action.undone_at,
    expiresAt: action.expires_at,
    canUndo: action.status === 'complete' && new Date(action.expires_at) > new Date(),
  });
});

/**
 * GET /cleanup/quota
 * Return current user's quota summary (for QuotaBanner component).
 */
router.get('/quota', requireAuth, async (req, res) => {
  try {
    const quota = await getQuotaSummary(req.user.id);
    return res.json({ quota });
  } catch (err) {
    logger.error('Failed to fetch quota', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch quota.' });
  }
});

module.exports = router;
