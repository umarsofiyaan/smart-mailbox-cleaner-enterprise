// src/routes/subscription.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
  verifyAndActivatePayment,
} = require('../services/stripeService');
const logger = require('../utils/logger');

/**
 * POST /subscription/checkout
 * Create a Razorpay subscription for Pro plan.
 */
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const checkoutData = await createCheckoutSession(
      req.user.id,
      req.user.email,
      req.user.displayName
    );

    return res.json(checkoutData);
  } catch (err) {
    logger.error('Razorpay checkout creation failed', err);
    return res.status(500).json({ error: 'Failed to create checkout.' });
  }
});

/**
 * POST /subscription/verify
 * Called after Razorpay frontend payment success to verify + activate.
 */
router.post('/verify', requireAuth, async (req, res) => {
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
  try {
    await verifyAndActivatePayment(req.user.id, {
      razorpay_payment_id,
      razorpay_subscription_id,
      razorpay_signature,
    });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Razorpay verification failed', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /subscription/portal
 * Create a Razorpay Customer Portal session.
 */
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { url } = await createPortalSession(req.user.id);
    return res.json({ url });
  } catch (err) {
    logger.error('Razorpay portal session creation failed', err);
    return res.status(500).json({ error: err.message || 'Failed to open billing portal.' });
  }
});

/**
 * GET /subscription/status
 * Get current subscription status for the user.
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getSubscriptionStatus(req.user.id);
    return res.json(status);
  } catch (err) {
    logger.error('Failed to fetch subscription status', err);
    return res.status(500).json({ error: 'Failed to fetch subscription status.' });
  }
});

/**
 * POST /subscription/webhook
 * Razorpay webhook endpoint.
 * IMPORTANT: Uses raw body (must be before express.json() in middleware chain).
 * Verify signature before processing any event.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing Razorpay signature.' });
  }

  try {
    await handleWebhook(req.body, signature);
    return res.json({ received: true });
  } catch (err) {
    logger.error('Razorpay webhook processing failed', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
