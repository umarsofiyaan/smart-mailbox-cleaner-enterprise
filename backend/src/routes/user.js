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
    await setPrimaryMailbox(req.user.id, req.params.mailboxId);
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
    await removeMailbox(req.user.id, req.params.mailboxId);
    return res.json({ success: true });
  } catch (err) {
    if (err.message === 'Mailbox not found.' || err.message === 'At least one mailbox must remain connected.') {
      return res.status(400).json({ error: err.message });
    }
    logger.error('Failed to remove mailbox', err, { userId: req.user.id, mailboxId: req.params.mailboxId });
    return res.status(500).json({ error: 'Failed to remove mailbox.' });
  }
});

module.exports = router;
