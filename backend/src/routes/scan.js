// src/routes/scan.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { requireAuth } = require('../middleware/auth');
const { requirePro } = require('../middleware/requirePro');
const { scanLimiter } = require('../middleware/security');
const { query } = require('../config/database');
const { getOAuthTokens } = require('../services/tokenService');
const { runScan } = require('../services/scanEngine');
const { enqueueScan } = require('../jobs/worker');
const logger = require('../utils/logger');

/**
 * POST /scan/start
 * Initiate a new scan. Enqueues a background job.
 * 
 * Free tier: 12-month scan only
 * Pro tier: full scan depth options
 */
router.post('/start', requireAuth, scanLimiter, async (req, res) => {
  const userId = req.user.id;
  let { scanDepth } = req.body;

  // Validate scanDepth
  const validDepths = ['12months', '24months', 'all'];
  if (!scanDepth || !validDepths.includes(scanDepth)) {
    scanDepth = '12months';
  }

  // Pro-only depths
  if (scanDepth !== '12months') {
    // DEV MODE: bypass with BYPASS_PRO env var
    if (process.env.BYPASS_PRO !== 'true') {
      const subResult = await query(
        "SELECT plan, status FROM subscription_status WHERE user_id = $1",
        [userId]
      );
      const sub = subResult.rows[0];
      const isPro = sub?.plan === 'pro' && sub?.status === 'active';

      if (!isPro) {
        return res.status(403).json({
          error: 'Full mailbox scan requires a Pro subscription.',
          code: 'PRO_REQUIRED',
          upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
        });
      }
    }
  }

  // Check for already-running scan
  const runningCheck = await query(
    "SELECT id FROM scans WHERE user_id = $1 AND status IN ('pending','running') ORDER BY started_at DESC LIMIT 1",
    [userId]
  );

  if (runningCheck.rows.length > 0) {
    return res.status(409).json({
      error: 'A scan is already in progress.',
      scanId: runningCheck.rows[0].id,
    });
  }

  // Create scan record
  const scanId = uuidv4();
  await query(
    `INSERT INTO scans (id, user_id, status, scan_depth)
     VALUES ($1, $2, 'pending', $3)`,
    [scanId, userId, scanDepth]
  );

  // Enqueue background job
  await enqueueScan(userId, scanId, scanDepth);

  logger.info('Scan queued', { scanId, userId, scanDepth });

  return res.status(202).json({
    scanId,
    status: 'pending',
    message: 'Scan started. Poll /scan/:scanId for results.',
    estimatedMinutes: scanDepth === 'all' ? '3-10' : '1-3',
  });
});

/**
 * GET /scan/:scanId
 * Poll scan status and results.
 */
router.get('/:scanId', requireAuth, async (req, res) => {
  const { scanId } = req.params;
  const userId = req.user.id;

  const result = await query(
    `SELECT id, status, scan_depth, total_messages_scanned,
            storage_used_bytes, storage_quota_bytes, storage_growth_daily_bytes,
            estimated_days_until_full, categories_json, confidence_summary,
            estimated_bytes_freeable, started_at, completed_at, error_message
     FROM scans
     WHERE id = $1 AND user_id = $2`,
    [scanId, userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Scan not found.' });
  }

  const scan = result.rows[0];

  return res.json({
    id: scan.id,
    status: scan.status,
    scanDepth: scan.scan_depth,
    progress: {
      messagesScanned: scan.total_messages_scanned,
    },
    storage: {
      usedBytes: scan.storage_used_bytes,
      quotaBytes: scan.storage_quota_bytes,
      usedGB: parseFloat(((scan.storage_used_bytes || 0) / (1024 ** 3)).toFixed(2)),
      quotaGB: parseFloat(((scan.storage_quota_bytes || 0) / (1024 ** 3)).toFixed(2)),
      percentUsed: scan.storage_quota_bytes
        ? parseFloat(((scan.storage_used_bytes / scan.storage_quota_bytes) * 100).toFixed(1))
        : 0,
      dailyGrowthBytes: scan.storage_growth_daily_bytes,
      estimatedDaysUntilFull: scan.estimated_days_until_full,
    },
    categories: scan.categories_json || [],
    confidenceSummary: scan.confidence_summary || {},
    estimatedFreeableBytes: scan.estimated_bytes_freeable,
    estimatedFreeableGB: parseFloat(((scan.estimated_bytes_freeable || 0) / (1024 ** 3)).toFixed(2)),
    startedAt: scan.started_at,
    completedAt: scan.completed_at,
    error: scan.error_message || null,
  });
});

/**
 * GET /scan/latest
 * Get the most recent completed scan for the user.
 */
router.get('/user/latest', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT id FROM scans
     WHERE user_id = $1 AND status = 'complete'
     ORDER BY completed_at DESC LIMIT 1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'No completed scans found.' });
  }

  // Redirect to the scan detail endpoint
  return res.json({ scanId: result.rows[0].id });
});

/**
 * GET /scan/history
 * List recent scans for the user.
 */
router.get('/user/history', requireAuth, async (req, res) => {
  const result = await query(
    `SELECT id, status, scan_depth, total_messages_scanned,
            estimated_bytes_freeable, started_at, completed_at
     FROM scans
     WHERE user_id = $1
     ORDER BY started_at DESC
     LIMIT 10`,
    [req.user.id]
  );

  return res.json({
    scans: result.rows.map(s => ({
      id: s.id,
      status: s.status,
      scanDepth: s.scan_depth,
      messagesScanned: s.total_messages_scanned,
      estimatedFreeableGB: parseFloat(((s.estimated_bytes_freeable || 0) / (1024 ** 3)).toFixed(2)),
      startedAt: s.started_at,
      completedAt: s.completed_at,
    })),
  });
});

module.exports = router;
