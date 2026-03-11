// src/routes/subscription.js
const express = require('express');
const router  = express.Router();

const { requireAuth }                           = require('../middleware/auth');
const { billingLimiter }                        = require('../middleware/security');
const { getQuotaSummary }                       = require('../services/quotaService');
const { getUserPricingContext, cachePricingInSession } = require('../services/pricingService');
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
  verifyAndActivatePayment,
} = require('../services/stripeService');
const logger = require('../utils/logger');

// ─── GET /subscription/pricing ───────────────────────────────────────────────
router.get('/pricing', requireAuth, async (req, res) => {
  try {
    const pricing = await getUserPricingContext(req.user.id, req);
    cachePricingInSession(res, pricing);
    return res.json(pricing);
  } catch (err) {
    logger.error('Failed to fetch regional pricing', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch pricing.' });
  }
});

// ─── POST /subscription/checkout ─────────────────────────────────────────────
// Creates a Razorpay Order (one-time payment). Returns orderId for the frontend.
router.post('/checkout', requireAuth, billingLimiter, async (req, res) => {
  const planType = String(req.body?.planType || 'pro').toLowerCase();
  try {
    const pricing = await getUserPricingContext(req.user.id, req);
    cachePricingInSession(res, pricing);

    const checkoutData = await createCheckoutSession(
      req.user.id,
      req.user.email,
      req.user.displayName,
      planType,
      { pricingRegion: pricing?.region || 'full' }
    );

    return res.json(checkoutData);
  } catch (err) {
    logger.error('Razorpay checkout creation failed', err, { userId: req.user.id, planType });
    return res.status(500).json({ error: 'Failed to create checkout. Please try again.' });
  }
});

// ─── POST /subscription/verify ───────────────────────────────────────────────
// Verifies HMAC signature of completed one-time payment and activates the plan.
// Expects: razorpay_payment_id, razorpay_order_id, razorpay_signature
router.post('/verify', requireAuth, billingLimiter, async (req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing required payment fields.' });
  }

  try {
    const result = await verifyAndActivatePayment(req.user.id, {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    });

    const quota = await getQuotaSummary(req.user.id);
    return res.json({ success: true, planType: result.planType, quota });
  } catch (err) {
    logger.error('Razorpay verification failed', err, { userId: req.user.id });
    return res.status(400).json({ error: err.message });
  }
});

// ─── GET /subscription/status ─────────────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user.id);
    return res.json(status);
  } catch (err) {
    logger.error('Failed to fetch subscription status', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to fetch subscription status.' });
  }
});

// ─── POST /subscription/portal ───────────────────────────────────────────────
router.post('/portal', requireAuth, billingLimiter, async (req, res) => {
  try {
    const { url } = await createPortalSession(req.user.id);
    return res.json({ url });
  } catch (err) {
    logger.error('Portal session failed', err, { userId: req.user.id });
    return res.status(500).json({ error: err.message || 'Failed to open billing portal.' });
  }
});

// ─── POST /subscription/cancel ───────────────────────────────────────────────
// One-time payments cannot be "cancelled" — credits are already granted.
// This endpoint is kept for API compatibility but does nothing harmful.
router.post('/cancel', requireAuth, billingLimiter, async (req, res) => {
  return res.status(400).json({
    error: 'One-time plan purchases cannot be cancelled. Credits do not expire.',
    info:  'If you need a refund, please contact support@umarsofiyaan.shop',
  });
});

// ─── POST /subscription/purchase (legacy) ─────────────────────────────────────
router.post('/purchase', requireAuth, billingLimiter, async (req, res) => {
  return res.status(410).json({
    error:   'DIRECT_PURCHASE_REMOVED',
    message: 'Use POST /subscription/checkout then POST /subscription/verify.',
  });
});

// ─── POST /subscription/webhook ───────────────────────────────────────────────
// Razorpay sends payment.captured here as a backup confirmation.
// Must use raw body for HMAC verification.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!signature) return res.status(400).json({ error: 'Missing Razorpay signature.' });

  try {
    await handleWebhook(req.body, signature);
    return res.json({ received: true });
  } catch (err) {
    logger.error('Webhook processing failed', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
