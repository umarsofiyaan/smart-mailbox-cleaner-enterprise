// src/routes/cleanup.js
const express = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { cleanupLimiter } = require('../middleware/security');
const { getOAuthTokens } = require('../services/tokenService');
const { createCleanupAction, undoCleanup, getCleanupHistory } = require('../services/cleanupService');
const { checkQuota, getQuotaSummary } = require('../services/quotaService');
const { enqueueCleanup } = require('../jobs/worker');
const { query } = require('../config/database');
const logger = require('../utils/logger');

router.post(
  '/execute',
  requireAuth,
  cleanupLimiter,
  [
    body('scanId').isUUID(),
    body('category').isString().isLength({ min: 1, max: 100 }),
    body('messageIds').optional().isArray(),
    body('messageIds.*').optional().isString(),
    body('estimatedBytes').optional().isInt({ min: 0 }),
    body('cleanupMode').optional().isIn(['ids', 'query']),
    body('customQuery').optional().isString().isLength({ min: 1, max: 2000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    let {
      scanId,
      category,
      messageIds = [],
      estimatedBytes = 0,
      cleanupMode = 'ids',
      customQuery,
    } = req.body;
    const userId = req.user.id;

    const scanCheck = await query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2',
      [scanId, userId]
    );
    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found or does not belong to you.' });
    }

    if (cleanupMode === 'ids' && messageIds.length === 0 && customQuery) {
      cleanupMode = 'query';
    }

    if (cleanupMode === 'query' && !customQuery) {
      return res.status(400).json({ error: 'customQuery is required when cleanupMode=query.' });
    }
    if (cleanupMode !== 'query' && messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds are required when cleanupMode=ids.' });
    }

    const quotaCheck = await checkQuota(userId);
    if (!quotaCheck.allowed) {
      return res.status(403).json({
        error: quotaCheck.reason,
        code: 'QUOTA_EXHAUSTED',
        upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
      });
    }

    try {
      const expectedCount = cleanupMode === 'query'
        ? 0
        : Math.min(messageIds.length, quotaCheck.remaining);

      const action = await createCleanupAction(userId, scanId, category, estimatedBytes, expectedCount);
      const jobId = await enqueueCleanup(userId, {
        actionId: action.id,
        scanId,
        category,
        cleanupMode,
        customQuery: cleanupMode === 'query' ? customQuery : null,
        messageIds: cleanupMode === 'ids' ? messageIds : [],
        estimatedBytes,
      });

      return res.status(202).json({
        queued: true,
        jobId,
        actionId: action.id,
        status: 'queued',
        message: 'Cleanup queued. Poll /cleanup/job/:jobId for progress.',
      });
    } catch (err) {
      logger.error('Cleanup enqueue failed', err, { userId, category });
      return res.status(500).json({ error: err.message || 'Cleanup failed.' });
    }
  }
);

router.get(
  '/job/:jobId',
  requireAuth,
  [param('jobId').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await query(
        `SELECT id, status, attempts, max_attempts, error_message, payload, started_at, completed_at
         FROM jobs
         WHERE id = $1 AND user_id = $2 AND job_type = 'CLEANUP'`,
        [req.params.jobId, req.user.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Cleanup job not found.' });
      }

      const row = result.rows[0];
      const payload = row.payload || {};
      const response = {
        jobId: row.id,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        error: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        actionId: payload.actionId || null,
        progress: payload.progress || null,
        result: payload.result || null,
      };

      if (row.status === 'complete' && !response.result && response.actionId) {
        const actionRes = await query(
          `SELECT id, status, message_count, bytes_freed, expires_at
           FROM cleanup_actions
           WHERE id = $1 AND user_id = $2`,
          [response.actionId, req.user.id]
        );
        if (actionRes.rows[0]) {
          response.result = {
            actionId: actionRes.rows[0].id,
            successCount: actionRes.rows[0].message_count || 0,
            failedCount: 0,
            bytesFreed: actionRes.rows[0].bytes_freed || 0,
            undoExpiresAt: actionRes.rows[0].expires_at,
          };
        }
      }

      return res.json(response);
    } catch (err) {
      logger.error('Failed to fetch cleanup job status', err, {
        userId: req.user.id,
        jobId: req.params.jobId,
      });
      return res.status(500).json({ error: 'Failed to fetch cleanup job status.' });
    }
  }
);

router.post(
  '/undo/:actionId',
  requireAuth,
  [param('actionId').isUUID()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const tokens = await getOAuthTokens(req.user.id);
      const result = await undoCleanup(req.params.actionId, req.user.id, tokens);
      return res.json({
        success: true,
        actionId: req.params.actionId,
        restoredCount: result.successCount,
        failedCount: result.failedCount,
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }
);

router.get(
  '/history',
  requireAuth,
  [
    qv('limit').optional().isInt({ min: 1, max: 100 }),
    qv('offset').optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await getCleanupHistory(
        req.user.id,
        parseInt(req.query.limit, 10) || 20,
        parseInt(req.query.offset, 10) || 0
      );
      return res.json(result);
    } catch (err) {
      logger.error('Failed to fetch cleanup history', err);
      return res.status(500).json({ error: 'Failed to fetch history.' });
    }
  }
);

router.get('/quota', requireAuth, async (req, res) => {
  try {
    const quota = await getQuotaSummary(req.user.id);
    return res.json({ quota });
  } catch (err) {
    logger.error('Failed to fetch quota', err);
    return res.status(500).json({ error: 'Failed to fetch quota.' });
  }
});

module.exports = router;

