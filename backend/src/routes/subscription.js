// src/routes/subscription.js
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
} = require('../services/stripeService');
const logger = require('../utils/logger');

/**
 * POST /subscription/checkout
 * Create a Stripe Checkout session for Pro plan.
 */
router.post('/checkout', requireAuth, async (req, res) => {
  try {
    const { sessionId, url } = await createCheckoutSession(
      req.user.id,
      req.user.email,
      req.user.displayName
    );

    return res.json({ sessionId, url });
  } catch (err) {
    logger.error('Stripe checkout session creation failed', err);
    return res.status(500).json({ error: 'Failed to create checkout session.' });
  }
});

/**
 * POST /subscription/portal
 * Create a Stripe Customer Portal session.
 */
router.post('/portal', requireAuth, async (req, res) => {
  try {
    const { url } = await createPortalSession(req.user.id);
    return res.json({ url });
  } catch (err) {
    logger.error('Stripe portal session creation failed', err);
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
 * Stripe webhook endpoint.
 * IMPORTANT: Uses raw body (must be before express.json() in middleware chain).
 * Verify signature before processing any event.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['stripe-signature'];

  if (!signature) {
    return res.status(400).json({ error: 'Missing Stripe signature.' });
  }

  try {
    await handleWebhook(req.body, signature);
    return res.json({ received: true });
  } catch (err) {
    logger.error('Stripe webhook processing failed', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
