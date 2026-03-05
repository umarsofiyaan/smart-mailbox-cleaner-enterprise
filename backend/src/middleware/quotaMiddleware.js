// src/middleware/quotaMiddleware.js

const { checkQuota } = require('../services/quotaService');

async function requireDeletionQuota(req, res, next) {
  const requestedDeleteCount = Math.max(
    1,
    Number(req.deletionRequestCount || req.body?.requestedDeleteCount || req.body?.expectedMessageCount || req.body?.messageIds?.length || 1)
  );

  const quotaCheck = await checkQuota(req.user.id, requestedDeleteCount);
  if (!quotaCheck.allowed) {
    return res.status(402).json({
      error: 'PAYWALL_REQUIRED',
      code: 'PAYWALL_REQUIRED',
      requestedDeleteCount,
      remainingCredits: quotaCheck.remaining,
      upgradeUrl: `${process.env.FRONTEND_URL}/pricing`,
    });
  }

  req.quotaCheck = quotaCheck;
  next();
}

module.exports = { requireDeletionQuota };
