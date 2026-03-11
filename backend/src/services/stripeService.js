// src/services/stripeService.js (Razorpay — One-Time Orders)
// Handles one-time payment checkout, verification, and webhooks.
// NO subscriptions, NO recurring charges, NO monthly billing.
//
// Flow:
//   1. POST /subscription/checkout  → createCheckoutSession() → razorpay.orders.create()
//   2. Frontend opens Razorpay modal with order_id
//   3. User pays → Razorpay calls handler with payment_id + order_id + signature
//   4. POST /subscription/verify    → verifyAndActivatePayment() → applyPurchasedPlan()
//   5. Webhook payment.captured     → double-confirms activation (idempotent)

const Razorpay = require('razorpay');
const crypto   = require('crypto');
const { query } = require('../config/database');
const { applyPurchasedPlan } = require('./quotaService');
const logger   = require('../utils/logger');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── Plan amounts ─────────────────────────────────────────────────────────────
// Amounts in paise (INR). Full = international users charged in INR via Razorpay.
// These are one-time charges — no plan_id needed, just an order amount.

function getPlanAmountPaise(planType, pricingRegion = 'full') {
  const reduced = String(pricingRegion).toLowerCase() === 'reduced';
  const suffix  = reduced ? 'LOW' : 'FULL';

  const envKey  = `RAZORPAY_${planType.toUpperCase()}_AMOUNT_PAISE_${suffix}`;
  if (process.env[envKey]) return Number(process.env[envKey]);

  // Hardcoded fallbacks (paise)
  const AMOUNTS = {
    full:    { starter: 29900, pro: 79900, power: 149900 },  // ₹299 / ₹799 / ₹1,499
    reduced: { starter: 14900, pro: 34900, power:  69900 },  // ₹149 / ₹349 / ₹699
  };

  return AMOUNTS[reduced ? 'reduced' : 'full'][planType] || 79900;
}

function getPlanLabel(planType) {
  return { starter: 'Starter', pro: 'Pro', power: 'Power' }[planType] || 'Plan';
}

function normalizePlanType(input) {
  const v = String(input || '').toLowerCase();
  return ['starter', 'pro', 'power'].includes(v) ? v : 'pro';
}

function normalizePricingRegion(region) {
  const v = String(region || '').toLowerCase();
  return v === 'reduced' || v === 'low' ? 'reduced' : 'full';
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

async function createCheckoutSession(userId, email, displayName, requestedPlanType, options = {}) {
  const planType      = normalizePlanType(requestedPlanType);
  const pricingRegion = normalizePricingRegion(options.pricingRegion);
  const amountPaise   = getPlanAmountPaise(planType, pricingRegion);
  const label         = getPlanLabel(planType);

  try {
    // Create a Razorpay Order (one-time payment — NOT a subscription)
    const order = await razorpay.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  `smbc_${planType}_${userId.slice(0, 8)}_${Date.now()}`,
      notes: {
        userId,
        email,
        planType,
        pricingRegion,
      },
    });

    // Store the order ID so the verify endpoint and webhook can look it up
    await query(
      `INSERT INTO subscription_status
         (user_id, stripe_customer_id, stripe_subscription_id, plan, status, pending_plan_type)
       VALUES ($1, $2, $2, 'free', 'pending', $3)
       ON CONFLICT (user_id) DO UPDATE
         SET stripe_customer_id     = $2,
             stripe_subscription_id  = $2,
             pending_plan_type       = $3,
             status                  = 'pending',
             updated_at              = NOW()`,
      [userId, order.id, planType]
    );

    logger.info('Razorpay order created', { userId, orderId: order.id, planType, amountPaise, pricingRegion });

    return {
      orderId:      order.id,         // used as order_id in Razorpay modal
      keyId:        process.env.RAZORPAY_KEY_ID,
      amount:       amountPaise,
      currency:     'INR',
      name:         'Smart Mailbox Cleaner',
      description:  `${label} Plan — one-time`,
      email,
      planType,
      pricingRegion,
    };
  } catch (err) {
    logger.error('Failed to create Razorpay order', err, { userId, planType });
    throw err;
  }
}

// ─── Payment Verification ─────────────────────────────────────────────────────
// Called immediately after the Razorpay modal succeeds in the browser.
// Verifies HMAC signature then grants the purchased plan credits.

async function verifyAndActivatePayment(userId, {
  razorpay_payment_id,
  razorpay_order_id,
  razorpay_signature,
}) {
  try {
    // Verify HMAC — order_id + "|" + payment_id for one-time orders
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      throw new Error('Payment signature verification failed. Do not tamper with payment data.');
    }

    // Determine plan type from our DB record (never trust the frontend for this)
    const pendingRes = await query(
      `SELECT pending_plan_type FROM subscription_status WHERE user_id = $1`,
      [userId]
    );

    // Double-check against the order's notes in Razorpay as fallback
    let planType = pendingRes.rows[0]?.pending_plan_type;
    if (!planType) {
      try {
        const order = await razorpay.orders.fetch(razorpay_order_id);
        planType = normalizePlanType(order.notes?.planType);
      } catch (fetchErr) {
        logger.warn('Could not fetch order from Razorpay — defaulting to pro', { err: fetchErr.message });
        planType = 'pro';
      }
    }

    planType = normalizePlanType(planType);
    await applyPurchasedPlan(userId, planType);

    await query(
      `UPDATE subscription_status
       SET plan                   = $4,
           status                 = 'active',
           stripe_subscription_id  = $1,
           current_period_end     = NULL,
           pending_plan_type      = NULL,
           updated_at             = NOW()
       WHERE user_id = $3`,
      [razorpay_order_id, null, userId, planType]
    );

    logger.info('Payment verified and plan activated', { userId, razorpay_order_id, razorpay_payment_id, planType });
    return { success: true, planType };
  } catch (err) {
    logger.error('Payment verification failed', err, { userId });
    throw err;
  }
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────
// Handles Razorpay webhook events.
// payment.captured is the primary success event for one-time orders.
// Acts as a fallback/double-confirm if verify was never called.

async function handleWebhook(rawBody, signature) {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) throw new Error('Webhook signature invalid.');

    const event = JSON.parse(rawBody);
    logger.info('Razorpay webhook received', { event: event.event });

    switch (event.event) {

      // ── One-time payment captured (primary success event) ─────────────────
      case 'payment.captured': {
        const payment = event.payload.payment?.entity;
        if (!payment) break;

        const orderId  = payment.order_id;
        const notes    = payment.notes || {};
        const userId   = notes.userId;

        if (!userId) {
          logger.warn('webhook payment.captured: no userId in notes', { orderId });
          break;
        }

        // Check if already activated (verify endpoint may have run first)
        const existing = await query(
          `SELECT status, pending_plan_type FROM subscription_status WHERE user_id = $1`,
          [userId]
        );
        const row = existing.rows[0];

        if (row?.status === 'active') {
          logger.info('Webhook: payment.captured — already active, skipping', { userId, orderId });
          break;
        }

        // Activate — idempotent fallback if verify wasn't called
        const planType = normalizePlanType(notes.planType || row?.pending_plan_type || 'pro');
        await applyPurchasedPlan(userId, planType);

        await query(
          `UPDATE subscription_status
           SET plan                   = $3,
               status                 = 'active',
               stripe_subscription_id  = $2,
               pending_plan_type      = NULL,
               updated_at             = NOW()
           WHERE user_id = $1`,
          [userId, orderId, planType]
        );

        logger.info('Webhook: payment.captured — plan activated', { userId, orderId, planType });
        break;
      }

      // ── Payment failed ────────────────────────────────────────────────────
      case 'payment.failed': {
        const payment = event.payload.payment?.entity;
        const orderId = payment?.order_id;
        const notes   = payment?.notes || {};
        const userId  = notes.userId;

        if (!userId) break;

        await query(
          `UPDATE subscription_status
           SET status = 'failed', updated_at = NOW()
           WHERE user_id = $1 AND status = 'pending'`,
          [userId]
        );

        logger.warn('Webhook: payment.failed', { userId, orderId });
        break;
      }

      default:
        logger.info('Webhook: unhandled event (ignored)', { event: event.event });
    }

    return { received: true };
  } catch (err) {
    logger.error('Webhook handling failed', err);
    throw err;
  }
}

// ─── Status / Portal ──────────────────────────────────────────────────────────

async function getSubscriptionStatus(userId) {
  const result = await query(
    `SELECT plan, status, current_period_end, updated_at
     FROM subscription_status
     WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || { plan: 'free', status: 'none' };
}

async function createPortalSession(userId) {
  // Razorpay has no hosted portal — return in-app billing management URL
  return { url: `${process.env.FRONTEND_URL}/dashboard?tab=billing` };
}

module.exports = {
  createCheckoutSession,
  verifyAndActivatePayment,
  handleWebhook,
  getSubscriptionStatus,
  createPortalSession,
};
