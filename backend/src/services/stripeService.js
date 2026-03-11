// src/services/stripeService.js (Razorpay — One-Time Orders, Multi-Currency)
// Handles one-time payment checkout, verification, and webhooks.
//
// Currency logic (geo-detected):
//   region = 'reduced'  → IN, ID, PH, BR, PK  → INR, amount in paise  (₹149/₹349/₹699)
//   region = 'full'     → US, GB, CA, AU, DE…  → USD, amount in cents  ($2.99/$7.99/$14.99)
//
// IMPORTANT: Razorpay requires "International Payments" to be enabled in your
// Razorpay Dashboard → Settings → International Payments before USD orders work.

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

// INR amounts in paise (₹1 = 100 paise)
const INR_AMOUNTS = {
  starter: Number(process.env.RAZORPAY_STARTER_AMOUNT_PAISE_LOW) || 14900,  // ₹149
  pro:     Number(process.env.RAZORPAY_PRO_AMOUNT_PAISE_LOW)     || 34900,  // ₹349
  power:   Number(process.env.RAZORPAY_POWER_AMOUNT_PAISE_LOW)   || 69900,  // ₹699
};

// USD amounts in cents ($1 = 100 cents)
const USD_AMOUNTS = {
  starter: Number(process.env.RAZORPAY_STARTER_AMOUNT_CENTS_FULL) || 299,   // $2.99
  pro:     Number(process.env.RAZORPAY_PRO_AMOUNT_CENTS_FULL)     || 799,   // $7.99
  power:   Number(process.env.RAZORPAY_POWER_AMOUNT_CENTS_FULL)   || 1499,  // $14.99
};

const PLAN_LABELS = { starter: 'Starter', pro: 'Pro', power: 'Power' };

function normalizePlanType(input) {
  const v = String(input || '').toLowerCase();
  return ['starter', 'pro', 'power'].includes(v) ? v : 'pro';
}

function normalizePricingRegion(region) {
  const v = String(region || '').toLowerCase();
  return v === 'reduced' || v === 'low' ? 'reduced' : 'full';
}

/**
 * Returns { currency, amount } for the given plan + region.
 * currency: 'INR' or 'USD'
 * amount:   smallest unit (paise for INR, cents for USD)
 */
function getPlanAmount(planType, pricingRegion) {
  if (normalizePricingRegion(pricingRegion) === 'reduced') {
    return { currency: 'INR', amount: INR_AMOUNTS[planType] || INR_AMOUNTS.pro };
  }
  return { currency: 'USD', amount: USD_AMOUNTS[planType] || USD_AMOUNTS.pro };
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

async function createCheckoutSession(userId, email, displayName, requestedPlanType, options = {}) {
  const planType      = normalizePlanType(requestedPlanType);
  const pricingRegion = normalizePricingRegion(options.pricingRegion);
  const { currency, amount } = getPlanAmount(planType, pricingRegion);
  const label         = PLAN_LABELS[planType] || 'Plan';

  try {
    // Create a Razorpay Order (one-time, no recurring billing)
    const order = await razorpay.orders.create({
      amount,
      currency,   // 'INR' or 'USD'
      receipt:    `smbc_${planType}_${userId.slice(0, 8)}_${Date.now()}`,
      notes: {
        userId,
        email,
        planType,
        pricingRegion,
        currency,
      },
    });

    // Store pending order in DB so verify + webhook can resolve the plan
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

    logger.info('Razorpay order created', { userId, orderId: order.id, planType, amount, currency, pricingRegion });

    return {
      orderId:     order.id,
      keyId:       process.env.RAZORPAY_KEY_ID,
      amount,
      currency,
      name:        'Smart Mailbox Cleaner',
      description: `${label} Plan — one-time`,
      email,
      planType,
      pricingRegion,
    };
  } catch (err) {
    logger.error('Failed to create Razorpay order', err, { userId, planType, currency });
    throw err;
  }
}

// ─── Payment Verification ─────────────────────────────────────────────────────

async function verifyAndActivatePayment(userId, {
  razorpay_payment_id,
  razorpay_order_id,
  razorpay_signature,
}) {
  try {
    // HMAC: order_id + "|" + payment_id  (Razorpay standard for orders)
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      throw new Error('Payment signature verification failed.');
    }

    // Resolve plan type from DB (never trust frontend)
    const pendingRes = await query(
      `SELECT pending_plan_type FROM subscription_status WHERE user_id = $1`,
      [userId]
    );

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
       SET plan                   = $2,
           status                 = 'active',
           stripe_subscription_id  = $3,
           current_period_end     = NULL,
           pending_plan_type      = NULL,
           updated_at             = NOW()
       WHERE user_id = $1`,
      [userId, planType, razorpay_order_id]
    );

    logger.info('Payment verified and plan activated', { userId, razorpay_order_id, planType });
    return { success: true, planType };
  } catch (err) {
    logger.error('Payment verification failed', err, { userId });
    throw err;
  }
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────

async function handleWebhook(rawBody, signature) {
  try {
    const expectedSig = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expectedSig !== signature) throw new Error('Webhook signature invalid.');

    const event = JSON.parse(rawBody);
    logger.info('Razorpay webhook received', { event: event.event });

    switch (event.event) {

      // Primary success event for one-time orders
      case 'payment.captured': {
        const payment = event.payload.payment?.entity;
        if (!payment) break;

        const orderId = payment.order_id;
        const notes   = payment.notes || {};
        const userId  = notes.userId;

        if (!userId) {
          logger.warn('webhook payment.captured: no userId in notes', { orderId });
          break;
        }

        // Skip if already activated by the verify endpoint
        const existing = await query(
          `SELECT status, pending_plan_type FROM subscription_status WHERE user_id = $1`,
          [userId]
        );
        if (existing.rows[0]?.status === 'active') {
          logger.info('Webhook: already active, skipping', { userId, orderId });
          break;
        }

        const planType = normalizePlanType(notes.planType || existing.rows[0]?.pending_plan_type || 'pro');
        await applyPurchasedPlan(userId, planType);

        await query(
          `UPDATE subscription_status
           SET plan = $2, status = 'active', stripe_subscription_id = $3,
               pending_plan_type = NULL, updated_at = NOW()
           WHERE user_id = $1`,
          [userId, planType, orderId]
        );

        logger.info('Webhook: payment.captured — plan activated', { userId, orderId, planType, currency: payment.currency });
        break;
      }

      case 'payment.failed': {
        const payment = event.payload.payment?.entity;
        const userId  = payment?.notes?.userId;
        if (!userId) break;

        await query(
          `UPDATE subscription_status SET status = 'failed', updated_at = NOW()
           WHERE user_id = $1 AND status = 'pending'`,
          [userId]
        );
        logger.warn('Webhook: payment.failed', { userId, orderId: payment?.order_id, currency: payment?.currency });
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
     FROM subscription_status WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || { plan: 'free', status: 'none' };
}

async function createPortalSession(userId) {
  return { url: `${process.env.FRONTEND_URL}/dashboard?tab=billing` };
}

module.exports = {
  createCheckoutSession,
  verifyAndActivatePayment,
  handleWebhook,
  getSubscriptionStatus,
  createPortalSession,
};
