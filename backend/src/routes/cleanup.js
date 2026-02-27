// src/routes/cleanup.js
const express = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const router = express.Router();

const { requireAuth }       = require('../middleware/auth');
const { cleanupLimiter }    = require('../middleware/security');
const { getOAuthTokens }    = require('../services/tokenService');
const { getGmailClient, collectMessageIdsByQuery } = require('../services/gmailService');
const { executeCleanup, undoCleanup, getCleanupHistory } = require('../services/cleanupService');
const { checkQuota, consumeQuota, getQuotaSummary }      = require('../services/quotaService');
const {
  sendCleanupReceipt,
  sendQuotaWarningIfNeeded,
  sendQuotaExhaustedIfNeeded,
} = require('../services/emailService');
const { query } = require('../config/database');
const logger    = require('../utils/logger');

// ─── Execute ──────────────────────────────────────────────────────────────────

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

    const {
      scanId,
      category,
      messageIds = [],
      estimatedBytes = 0,
      cleanupMode = 'ids',
      customQuery,
    } = req.body;
    const userId = req.user.id;

    // Verify scan belongs to user
    const scanCheck = await query(
      'SELECT id FROM scans WHERE id = $1 AND user_id = $2', [scanId, userId]
    );
    if (scanCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Scan not found or does not belong to you.' });
    }

    if (cleanupMode === 'query' && !customQuery) {
      return res.status(400).json({ error: 'customQuery is required when cleanupMode=query.' });
    }
    if (cleanupMode !== 'query' && messageIds.length === 0) {
      return res.status(400).json({ error: 'messageIds are required when cleanupMode=ids.' });
    }

    // Check quota
    const quotaCheck = await checkQuota(userId);
    if (!quotaCheck.allowed) {
      return res.status(403).json({
        error: quotaCheck.reason,
        code: 'QUOTA_EXHAUSTED',
        upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
      });
    }

    try {
      const tokens = await getOAuthTokens(userId);
      let effectiveIds;

      if (cleanupMode === 'query') {
        const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken);
        effectiveIds = await collectMessageIdsByQuery(gmail, customQuery, {
          maxMessages: quotaCheck.remaining,
        });
      } else {
        // Trim message list to quota remaining
        effectiveIds = messageIds.slice(0, quotaCheck.remaining);
      }

      if (!effectiveIds.length) {
        return res.status(400).json({ error: 'No matching emails found for cleanup.' });
      }

      const result = await executeCleanup(userId, scanId, category, effectiveIds, estimatedBytes, tokens);

      await consumeQuota(userId, result.successCount);

      // ── Fire-and-forget emails ────────────────────────────────────────────
      setImmediate(async () => {
        try {
          const userResult = await query(
            'SELECT email, display_name FROM users WHERE id = $1', [userId]
          );
          if (!userResult.rows[0]) return;

          const { email, display_name } = userResult.rows[0];
          const updatedQuota = await getQuotaSummary(userId);
          const isPro              = updatedQuota.isPro;
          const lifetimeUsed       = updatedQuota.lifetime?.used ?? 0;
          const lifetimeAllowance  = updatedQuota.lifetime?.allowance ?? 5000;
          const quotaRemaining     = updatedQuota.lifetime?.remaining ?? 0;

          sendCleanupReceipt(email, display_name, {
            category,
            messageCount: result.successCount,
            bytesFreed: result.bytesFreed,
            undoExpiresAt: result.undoExpiresAt,
            quotaRemaining,
            isPro,
          });

          if (!isPro) {
            sendQuotaWarningIfNeeded(userId, email, display_name, lifetimeUsed, lifetimeAllowance);
            if (quotaRemaining === 0) {
              sendQuotaExhaustedIfNeeded(userId, email, display_name);
            }
          }
        } catch (e) {
          logger.error('Post-cleanup email error', e);
        }
      });

      return res.json({
        success: true,
        actionId: result.actionId,
        successCount: result.successCount,
        failedCount: result.failedCount,
        bytesFreed: result.bytesFreed,
        undoExpiresAt: result.undoExpiresAt,
        message: `${result.successCount} emails moved to Trash. You have 30 days to undo.`,
      });

    } catch (err) {
      logger.error('Cleanup execute failed', err, { userId, category });
      return res.status(500).json({ error: err.message || 'Cleanup failed.' });
    }
  }
);

// ─── Undo ────────────────────────────────────────────────────────────────────

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

// ─── History (paginated) ──────────────────────────────────────────────────────

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
        parseInt(req.query.limit)  || 20,
        parseInt(req.query.offset) || 0
      );
      return res.json(result);
    } catch (err) {
      logger.error('Failed to fetch cleanup history', err);
      return res.status(500).json({ error: 'Failed to fetch history.' });
    }
  }
);

// ─── Quota ────────────────────────────────────────────────────────────────────

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
