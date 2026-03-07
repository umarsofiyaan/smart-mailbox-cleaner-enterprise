// src/routes/subscription.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { applyPurchasedPlan, getQuotaSummary } = require('../services/quotaService');
const { getUserPricingContext, cachePricingInSession } = require('../services/pricingService');
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
  verifyAndActivatePayment,
} = require('../services/stripeService');
const logger = require('../utils/logger');

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

/**
 * POST /subscription/checkout
 * Body: { planType?: 'starter'|'pro'|'power' }
 */
router.post('/checkout', requireAuth, async (req, res) => {
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
    logger.error('Razorpay checkout creation failed', err);
    return res.status(500).json({ error: 'Failed to create checkout.' });
  }
});

/**
 * POST /subscription/purchase
 * Body: { plan_type: 'starter'|'pro'|'power' }
 * NOTE: This endpoint applies the purchased plan immediately.
 * In production, call this after a verified payment event.
 */
router.post('/purchase', requireAuth, async (req, res) => {
  if (process.env.ALLOW_DIRECT_PURCHASE !== 'true') {
    return res.status(403).json({
      error: 'DIRECT_PURCHASE_DISABLED',
      message: 'Use Razorpay checkout and payment verification flow.',
    });
  }

  const planType = String(req.body?.plan_type || '').toLowerCase();
  if (!['starter', 'pro', 'power'].includes(planType)) {
    return res.status(400).json({ error: 'Invalid plan_type. Must be starter, pro, or power.' });
  }

  try {
    const quota = await applyPurchasedPlan(req.user.id, planType);
    return res.json({ success: true, planType, quota });
  } catch (err) {
    logger.error('Plan purchase activation failed', err, { userId: req.user.id, planType });
    return res.status(500).json({ error: err.message || 'Failed to activate plan.' });
  }
});

router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
  try {
    await verifyAndActivatePayment(req.user.id, {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    });
    const quota = await getQuotaSummary(req.user.id);
    return res.json({ success: true, quota });
  } catch (err) {
    logger.error('Razorpay verification failed', err);
    return res.status(400).json({ error: err.message });
  }
});

router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { url } = await createPortalSession(req.user.id);
    return res.json({ url });
  } catch (err) {
    logger.error('Portal session creation failed', err);
    return res.status(500).json({ error: err.message || 'Failed to open billing portal.' });
  }
});

router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user.id);
    return res.json(status);
  } catch (err) {
    logger.error('Failed to fetch subscription status', err);
    return res.status(500).json({ error: 'Failed to fetch subscription status.' });
  }
});

router.post('/cancel', requireAuth, async (req, res) => {
  const { query } = require('../config/database');
  try {
    const result = await query(
      'SELECT stripe_subscription_id FROM subscription_status WHERE user_id = $1',
      [req.user.id]
    );
    if (!result.rows[0]?.stripe_subscription_id) {
      return res.status(404).json({ error: 'No active subscription found.' });
    }
    const subId = result.rows[0].stripe_subscription_id;
    const Razorpay = require('razorpay');
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    await razorpay.subscriptions.cancel(subId, { cancel_at_cycle_end: 1 });
    await query(
      "UPDATE subscription_status SET status='canceled', updated_at=NOW() WHERE user_id=$1",
      [req.user.id]
    );
    return res.json({ success: true });
  } catch (err) {
    logger.error('Cancel subscription failed', err);
    return res.status(500).json({ error: err.message || 'Cancellation failed.' });
  }
});

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
