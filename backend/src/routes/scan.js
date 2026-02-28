// src/routes/scan.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const { requireAuth } = require('../middleware/auth');
const { scanLimiter } = require('../middleware/security');
const { query } = require('../config/database');
const { getOAuthTokens } = require('../services/tokenService');
const { runScan, runCustomScan } = require('../services/scanEngine');
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
 * GET /scan/user/latest
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
 * GET /scan/user/history
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



// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a Gmail search query from custom scan params.
 * Mirrors the logic in frontend CustomScanBuilder.jsx buildQueryPreview().
 */
function buildCustomQuery(params) {
  const parts = [];
  if (params.sizeMin)   parts.push(`larger:${params.sizeMin}`);
  if (params.olderThan) parts.push(`older_than:${params.olderThan}`);
  if (params.dateFrom)  parts.push(`after:${String(params.dateFrom).replace(/-/g, '/')}`);
  if (params.dateTo)    parts.push(`before:${String(params.dateTo).replace(/-/g, '/')}`);
  if (params.category && params.category !== 'all') parts.push(`category:${params.category}`);
  if (params.hasType === 'attachment')     parts.push('has:attachment');
  else if (params.hasType === 'drive')     parts.push('has:drive');
  else if (params.hasType === 'calendar')  parts.push('filename:invite.ics');
  else if (params.hasType === 'no_attachment') parts.push('-has:attachment');
  if (params.fromFilter?.trim())     parts.push(`from:${params.fromFilter.trim()}`);
  if (params.subjectFilter?.trim())  parts.push(`subject:(${params.subjectFilter.trim()})`);
  if (params.readStatus === 'read')   parts.push('is:read');
  else if (params.readStatus === 'unread') parts.push('is:unread');
  if (params.excludeStarred !== false) parts.push('-is:starred');
  if (params.location === 'inbox') parts.push('in:inbox');
  else if (params.location === 'sent') parts.push('in:sent');
  parts.push('-in:trash -in:spam');
  return parts.join(' ');
}

/**
 * POST /scan/preview-custom
 * Estimate how many emails match the custom query (for live count in UI).
 * Free users are capped by remaining free quota; Pro users are uncapped.
 */
router.post('/preview-custom', requireAuth, async (req, res) => {
  try {
    const tokens = await getOAuthTokens(req.user.id);
    const { getGmailClient } = require('../services/gmailService');
    const { checkQuota } = require('../services/quotaService');

    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken);
    const q = buildCustomQuery(req.body);

    // Gmail returns a server-side estimate without full traversal.
    const response = await gmail.users.messages.list({
      userId: 'me',
      q,
      fields: 'resultSizeEstimate,nextPageToken',
    });

    const rawEstimate = response.data.resultSizeEstimate || 0;
    const quota = await checkQuota(req.user.id);
    const effectiveCap = quota.allowed ? quota.remaining : 0;
    const estimate = Number.isFinite(effectiveCap)
      ? Math.min(rawEstimate, effectiveCap)
      : rawEstimate;

    return res.json({ estimate, query: q });
  } catch (err) {
    logger.error('Custom scan preview failed', { err: err.message });
    return res.status(500).json({ error: 'Preview failed.', estimate: null });
  }
});

/**
 * POST /scan/start-custom
 * Start a custom-filtered scan.
 * Free users are capped by remaining free quota; Pro users are uncapped.
 */
router.post('/start-custom', requireAuth, scanLimiter, async (req, res) => {
  const userId = req.user.id;

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

  const q = buildCustomQuery(req.body);
  if (!q.replace('-in:trash -in:spam', '').trim()) {
    return res.status(400).json({ error: 'Please set at least one filter.' });
  }

  // Create scan record (store custom query in scan_depth field for reference)
  const scanId = uuidv4();
  await query(
    `INSERT INTO scans (id, user_id, status, scan_depth) VALUES ($1, $2, 'pending', $3)`,
    [scanId, userId, 'custom']
  );

  // Enqueue custom scan job
  await query(
    `INSERT INTO jobs (user_id, job_type, payload, status) VALUES ($1, 'CUSTOM_SCAN', $2, 'queued')`,
    [userId, JSON.stringify({ scanId, customQuery: q })]
  );

  logger.info('Custom scan queued', { scanId, userId, query: q });

  return res.status(202).json({
    scanId,
    query: q,
    status: 'pending',
    message: 'Custom scan started. Poll /scan/:scanId for results.',
  });
});


/**
 * GET /scan/diagnose
 * Tests Gmail API connectivity and returns the real error if any.
 * Remove this endpoint before going to production.
 */
/**
 * GET /scan/diagnose?token=ACCESS_TOKEN
 * Tests Gmail API connectivity. Accepts token via query param to bypass CORS.
 * REMOVE THIS ENDPOINT BEFORE GOING TO PRODUCTION.
 */
router.get('/diagnose', async (req, res) => {
  // Allow token via query param so it's callable from the browser address bar
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Pass ?token=YOUR_ACCESS_TOKEN in the URL' });

  // Verify it's a valid JWT and get user
  let userId;
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    userId = decoded.userId || decoded.sub || decoded.id;
    if (!userId) throw new Error('No userId in token');
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token: ' + err.message });
  }

  try {
    const tokens = await getOAuthTokens(userId);
    const { getGmailClient, getStorageQuota } = require('../services/gmailService');
    const { google } = require('googleapis');
    const { createAuthenticatedClient } = require('../config/google');
    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

    const results = {};

    // Test 1: Can we reach Google at all? (simple DNS + TCP test)
    try {
      const https = require('https');
      await new Promise((resolve, reject) => {
        const req2 = https.get('https://www.googleapis.com/', { timeout: 5000 }, resolve);
        req2.on('error', reject);
        req2.on('timeout', () => reject(new Error('TCP timeout after 5s')));
      });
      results.googleReachable = { ok: true };
    } catch (err) {
      results.googleReachable = { ok: false, error: err.message, code: err.code };
    }

    // Test 2: Gmail profile API call
    try {
      const profile = await Promise.race([
        gmail.users.getProfile({ userId: 'me' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 8s')), 8000))
      ]);
      results.gmailProfile = { ok: true, email: profile.data.emailAddress, total: profile.data.messagesTotal };
    } catch (err) {
      results.gmailProfile = { ok: false, status: err?.response?.status, code: err?.code, error: err?.response?.data?.error?.message || err.message };
    }

    // Test 3: Gmail search (small)
    try {
      const r = await Promise.race([
        gmail.users.messages.list({ userId: 'me', q: 'has:attachment larger:5M -in:trash', maxResults: 5 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 8s')), 8000))
      ]);
      results.gmailSearch = { ok: true, estimate: r.data.resultSizeEstimate, count: (r.data.messages || []).length };
    } catch (err) {
      results.gmailSearch = { ok: false, status: err?.response?.status, code: err?.code, error: err?.response?.data?.error?.message || err.message };
    }

    // Test 4: Drive quota
    try {
      const q = await Promise.race([
        getStorageQuota(tokens.accessToken, tokens.refreshToken),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 8s')), 8000))
      ]);
      results.driveQuota = { ok: true, usedGB: (q.storageUsedBytes / 1e9).toFixed(2) };
    } catch (err) {
      results.driveQuota = { ok: false, status: err?.response?.status, code: err?.code, error: err?.response?.data?.error?.message || err.message };
    }

    results.tokenExpiry = tokens.tokenExpiry ? new Date(tokens.tokenExpiry).toISOString() : 'unknown';
    results.hasRefreshToken = !!tokens.refreshToken;

    return res.json({ ok: true, userId, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /scan/diagnose-old (original requireAuth version, kept for reference)
 */
router.get('/diagnose-OLD', requireAuth, async (req, res) => {
  try {
    const tokens = await getOAuthTokens(req.user.id);
    const { getGmailClient, collectMessageIdsByQuery, getStorageQuota } = require('../services/gmailService');
    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);

    const results = {};

    // Test 1: Gmail profile
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      results.gmailProfile = { ok: true, email: profile.data.emailAddress, totalMessages: profile.data.messagesTotal };
    } catch (err) {
      results.gmailProfile = { ok: false, status: err?.response?.status, error: err?.response?.data?.error?.message || err.message };
    }

    // Test 2: Drive quota
    try {
      const quota = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
      results.driveQuota = { ok: true, usedGB: (quota.storageUsedBytes / 1e9).toFixed(2) };
    } catch (err) {
      results.driveQuota = { ok: false, status: err?.response?.status, error: err?.response?.data?.error?.message || err.message };
    }

    // Test 3: Simple Gmail search (large attachments)
    try {
      const r = await gmail.users.messages.list({
        userId: 'me',
        q: 'has:attachment larger:5M -in:trash',
        maxResults: 5,
        fields: 'resultSizeEstimate,messages(id)',
      });
      results.gmailSearch = { ok: true, estimate: r.data.resultSizeEstimate, firstIds: (r.data.messages || []).map(m => m.id) };
    } catch (err) {
      results.gmailSearch = { ok: false, status: err?.response?.status, error: err?.response?.data?.error?.message || err.message };
    }

    // Test 4: Token scopes
    results.tokenExpiry = tokens.tokenExpiry ? new Date(tokens.tokenExpiry).toISOString() : 'unknown';
    results.hasRefreshToken = !!tokens.refreshToken;

    return res.json({ ok: true, userId: req.user.id, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
