// src/routes/user.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { getQuotaSummary } = require('../services/quotaService');
const logger = require('../utils/logger');

router.get('/quota', requireAuth, async (req, res) => {
  try {
    const quota = await getQuotaSummary(req.user.id);
    return res.json({
      delete_credits: quota.deleteCredits,
      plan_type: quota.planType,
      plan_expiry: quota.planExpiry,
      emails_deleted_total: quota.emailsDeletedTotal,
      storage_recovered_bytes: quota.storageRecoveredBytes,
      is_power_active: quota.isPowerActive,
    });
  } catch (err) {
    logger.error('Failed to fetch user quota', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch user quota.' });
  }
});

module.exports = router;
