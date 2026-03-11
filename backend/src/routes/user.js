// src/routes/user.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { getQuotaSummary } = require('../services/quotaService');
const { query } = require('../config/database');
const { getUserPricingContext, cachePricingInSession } = require('../services/pricingService');
const {
  listConnectedMailboxes,
  setPrimaryMailbox,
  removeMailbox,
} = require('../services/mailboxService');
const { getOAuthTokens } = require('../services/tokenService');
const { getStorageQuota } = require('../services/gmailService');
const logger = require('../utils/logger');

router.get('/quota', requireAuth, async (req, res) => {
  try {
    const quota = await getQuotaSummary(req.user.id);
    return res.json({
      delete_credits: quota.deleteCredits,
      plan_type: quota.planType,
      plan_expiry: quota.planExpiry,
      emails_deleted_total: quota.emailsDeletedTotal,
      storage_recovered_mb: quota.storageRecoveredMb,
      storage_recovered_bytes: quota.storageRecoveredBytes,
      is_power_active: quota.isPowerActive,
    });
  } catch (err) {
    logger.error('Failed to fetch user quota', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch user quota.' });
  }
});

router.get('/guardian', requireAuth, async (req, res) => {
  try {
    const settingsRes = await query(
      `SELECT auto_clean_enabled, auto_clean_frequency, auto_clean_max_inbox_mb, auto_clean_last_run_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );
    const row = settingsRes.rows[0] || {};
    const pricing = await getUserPricingContext(req.user.id, req);
    cachePricingInSession(res, pricing);
    const reduced = pricing?.region === 'reduced';

    return res.json({
      auto_clean_enabled: !!row.auto_clean_enabled,
      auto_clean_frequency: row.auto_clean_frequency || 'weekly',
      auto_clean_max_inbox_mb: Number(row.auto_clean_max_inbox_mb || 5120),
      auto_clean_last_run_at: row.auto_clean_last_run_at || null,
      plans: reduced
        ? {
            lite_usd: 1,
            pro_usd: 2,
          }
        : {
            lite_usd: 2,
            pro_usd: 4,
          },
      region: pricing?.region || 'full',
      rules: [
        'Delete promotions older than 30 days',
        'Delete newsletters automatically',
        'Keep inbox below configurable size',
      ],
    });
  } catch (err) {
    logger.error('Failed to fetch guardian settings', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch guardian settings.' });
  }
});

router.patch('/guardian', requireAuth, async (req, res) => {
  try {
    const enabled = !!req.body?.auto_clean_enabled;
    const frequency = String(req.body?.auto_clean_frequency || 'weekly').toLowerCase();
    const maxInboxMb = Math.max(512, Number(req.body?.auto_clean_max_inbox_mb || 5120));
    if (!['daily', 'weekly'].includes(frequency)) {
      return res.status(400).json({ error: 'auto_clean_frequency must be daily or weekly.' });
    }

    await query(
      `UPDATE users
       SET auto_clean_enabled = $2,
           auto_clean_frequency = $3,
           auto_clean_max_inbox_mb = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [req.user.id, enabled, frequency, maxInboxMb]
    );

    return res.json({
      success: true,
      auto_clean_enabled: enabled,
      auto_clean_frequency: frequency,
      auto_clean_max_inbox_mb: maxInboxMb,
    });
  } catch (err) {
    logger.error('Failed to update guardian settings', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to update guardian settings.' });
  }
});

router.get('/mailboxes', requireAuth, async (req, res) => {
  try {
    const result = await listConnectedMailboxes(req.user.id);
    return res.json(result);
  } catch (err) {
    logger.error('Failed to fetch mailboxes', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch mailboxes.' });
  }
});

router.patch('/mailboxes/:mailboxId/primary', requireAuth, async (req, res) => {
  try {
    await setPrimaryMailbox(req.user.id, req.params.mailboxId, {
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'user',
    });
    return res.json({ success: true });
  } catch (err) {
    if (err.message === 'Mailbox not found.') {
      return res.status(404).json({ error: err.message });
    }
    logger.error('Failed to set primary mailbox', err, { userId: req.user.id, mailboxId: req.params.mailboxId });
    return res.status(500).json({ error: 'Failed to set primary mailbox.' });
  }
});

router.delete('/mailboxes/:mailboxId', requireAuth, async (req, res) => {
  try {
    await removeMailbox(req.user.id, req.params.mailboxId, {
      actorUserId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'user',
    });
    return res.json({ success: true });
  } catch (err) {
    if (err.message === 'Mailbox not found.' || err.message === 'At least one mailbox must remain connected.') {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Failed to remove mailbox', err, { userId: req.user.id, mailboxId: req.params.mailboxId });
    return res.status(500).json({ error: 'Failed to remove mailbox.' });
  }
});

/**
 * GET /user/storage-growth
 * Fetches live Gmail storage quota and computes daily growth rate instantly.
 *
 * Strategy:
 *  1. Fetch current storage from Google Drive API (live, no scan needed).
 *  2. Pull historical storage data from all completed scans (already stored).
 *  3. Build a timeline: [...past scans, today's live reading].
 *  4. With >= 2 data points: compute best-fit daily growth.
 *  5. With only 1 data point (first ever login, no scans yet): return storage
 *     info without growth data but store current reading for next visit.
 *
 * This means even a user with ONE past scan will see growth data immediately
 * on their next login because we compare (last-scan bytes, last-scan date)
 * against (current bytes, now).
 */
router.get('/storage-growth', requireAuth, async (req, res) => {
  try {
    const mailboxId = req.query.mailboxId || null;
    const tokens = await getOAuthTokens(req.user.id, mailboxId);

    // 1. Live storage from Google Drive API
    // Falls back to scan history if Drive scope not granted or API unreachable.
    let liveStorageFetched = true;
    let needsDriveReauth   = false;
    let liveStorageRaw;
    try {
      liveStorageRaw = await getStorageQuota(tokens.accessToken, tokens.refreshToken);
    } catch (err) {
      liveStorageFetched = false;
      // 401/403 with PERMISSION_DENIED → Drive scope not granted on this token.
      // Return a flag so the frontend can show a "Reconnect Google" button.
      const status  = err?.response?.status || err?.code;
      const errBody = err?.response?.data?.error;
      const isDriveScope =
        status === 403 ||
        status === 401 ||
        (typeof errBody === 'object' && errBody?.status === 'PERMISSION_DENIED') ||
        (typeof errBody === 'string'  && errBody?.includes('insufficientPermissions')) ||
        err?.message?.includes('insufficientPermissions') ||
        err?.message?.includes('Access Not Configured') ||
        err?.message?.includes('PERMISSION_DENIED');
      if (isDriveScope) {
        needsDriveReauth = true;
        logger.warn('storage-growth: Drive scope not granted — user needs reauth', { userId: req.user.id });
      } else {
        logger.warn('storage-growth: Drive API unavailable — using scan fallback', { err: err.message, userId: req.user.id });
      }
    }

    // Fallback: compute growth from scan history when Drive API is unavailable.
    // Same algorithm as the live path — compare oldest vs newest scan storage readings.
    if (!liveStorageFetched) {
      const fallbackRes = await query(
        `SELECT storage_used_bytes, storage_quota_bytes, completed_at
         FROM scans
         WHERE user_id = $1 AND status = 'complete' AND storage_used_bytes > 0
         ORDER BY completed_at ASC
         LIMIT 30`,
        [req.user.id]
      );

      const rows = fallbackRes.rows;
      if (!rows.length) {
        return res.status(503).json({ error: 'Could not fetch storage data. Please try again.' });
      }

      const latest    = rows[rows.length - 1];
      const fbUsed    = Number(latest.storage_used_bytes)  || 0;
      const fbQuota   = Number(latest.storage_quota_bytes) || (15 * 1024 * 1024 * 1024);
      const fbPercent = fbQuota > 0 ? Math.round((fbUsed / fbQuota) * 100) : 0;

      let fbDailyGrowth   = 0;
      let fbDaysUntilFull = null;

      if (rows.length >= 2) {
        const oldest      = rows[0];
        const newest      = rows[rows.length - 1];
        const daysBetween = Math.max(
          1,
          (new Date(newest.completed_at).getTime() - new Date(oldest.completed_at).getTime()) / (1000 * 60 * 60 * 24)
        );
        const growth = Number(newest.storage_used_bytes) - Number(oldest.storage_used_bytes);

        if (growth > 0) {
          fbDailyGrowth   = Math.round(growth / daysBetween);
          const remaining = fbQuota - fbUsed;
          fbDaysUntilFull = remaining > 0 && fbDailyGrowth > 0
            ? Math.min(Math.floor(remaining / fbDailyGrowth), 9999)
            : null;
        }
      }

      // Check if all scans are from the same day — growth can't be computed
      const oldestDate = new Date(rows[0].completed_at);
      const newestDate = new Date(rows[rows.length - 1].completed_at);
      const spanDays   = (newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24);
      const scansTooRecent = rows.length < 2 || spanDays < 1;

      return res.json({
        usedBytes:              fbUsed,
        quotaBytes:             fbQuota,
        percentUsed:            fbPercent,
        dailyGrowthBytes:       fbDailyGrowth,
        estimatedDaysUntilFull: fbDaysUntilFull,
        isEstimate:             true,
        dataPointCount:         rows.length,
        scansTooRecent,           // true when all scans done within same day
        scanSpanDays:            parseFloat(spanDays.toFixed(1)),
        source:                 'scan_fallback',
        needsDriveReauth,
      });
    }

    const usedBytes  = liveStorageRaw.storageUsedBytes  || 0;
    const quotaBytes = liveStorageRaw.storageQuotaBytes || (15 * 1024 * 1024 * 1024);
    const percentUsed = quotaBytes > 0
      ? Math.round((usedBytes / quotaBytes) * 100)
      : 0;

    // 2. Historical data points from completed scans
    const historyRes = await query(
      `SELECT storage_used_bytes, completed_at
       FROM scans
       WHERE user_id = $1
         AND status = 'complete'
         AND storage_used_bytes > 0
       ORDER BY completed_at ASC
       LIMIT 30`,
      [req.user.id]
    );

    const dataPoints = historyRes.rows.map(r => ({
      bytes: Number(r.storage_used_bytes),
      date:  new Date(r.completed_at),
    }));

    // Add today's live reading as the latest data point
    dataPoints.push({ bytes: usedBytes, date: new Date() });

    // 3. Compute daily growth from all available data points
    let dailyGrowthBytes = 0;
    let estimatedDaysUntilFull = null;
    let isEstimate = false;
    let dataPointCount = dataPoints.length;

    if (dataPoints.length >= 2) {
      // Use the oldest and newest points for a stable long-range rate
      const oldest = dataPoints[0];
      const newest  = dataPoints[dataPoints.length - 1];
      const daysBetween = Math.max(
        1,
        (newest.date.getTime() - oldest.date.getTime()) / (1000 * 60 * 60 * 24)
      );
      const growth = newest.bytes - oldest.bytes;

      if (growth > 0) {
        dailyGrowthBytes = Math.round(growth / daysBetween);
        const remaining = quotaBytes - usedBytes;
        estimatedDaysUntilFull = remaining > 0 && dailyGrowthBytes > 0
          ? Math.min(Math.floor(remaining / dailyGrowthBytes), 9999)
          : null;
      }
      // If growth <= 0 (user cleaned up), keep dailyGrowthBytes = 0 → "Not growing"
    }

    // Only 1 data point (no previous scan + this is their first live fetch):
    // We have no growth rate yet — frontend will show the right message.

    return res.json({
      usedBytes,
      quotaBytes,
      percentUsed,
      dailyGrowthBytes,
      estimatedDaysUntilFull,
      isEstimate,
      dataPointCount,
      source: 'live',
    });
  } catch (err) {
    logger.error('Failed to compute storage growth', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to compute storage growth.' });
  }
});

module.exports = router;
