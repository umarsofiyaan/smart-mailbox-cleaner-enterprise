// src/services/stripeService.js (Razorpay)
// Handles checkout, payment verification, webhooks, and subscription status.
// Plan model: starter, pro, power.

const Razorpay = require('razorpay');
const crypto   = require('crypto');
const { query } = require('../config/database');
const { applyPurchasedPlan } = require('./quotaService');
const logger   = require('../utils/logger');

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const FALLBACK_PLAN_ID = process.env.RAZORPAY_PLAN_ID || 'plan_default';

function normalizePricingRegion(region) {
  const value = String(region || '').toLowerCase();
  if (value === 'reduced' || value === 'low') return 'reduced';
  return 'full';
}

function buildPlanConfig(pricingRegion = 'full') {
  const reduced = normalizePricingRegion(pricingRegion) === 'reduced';
  const suffix = reduced ? 'LOW' : 'FULL';

  const getPlanId = (base) =>
    process.env[`RAZORPAY_PLAN_ID_${base}_${suffix}`]
    || process.env[`RAZORPAY_PLAN_ID_${base}`]
    || FALLBACK_PLAN_ID;

  const getAmount = (base, fallback) =>
    Number(
      process.env[`RAZORPAY_${base}_AMOUNT_PAISE_${suffix}`]
      || process.env[`RAZORPAY_${base}_AMOUNT_PAISE`]
      || fallback
    );

  return {
    starter: {
      label: 'Starter',
      periodMonths: 1,
      totalCount: 1,
      amountPaise: getAmount('STARTER', reduced ? 149 : 299),
      planId: getPlanId('STARTER'),
    },
    pro: {
      label: 'Pro',
      periodMonths: 1,
      totalCount: 1,
      amountPaise: getAmount('PRO', reduced ? 349 : 799),
      planId: getPlanId('PRO'),
    },
    power: {
      label: 'Power',
      periodMonths: 1,
      totalCount: 1,
      amountPaise: getAmount('POWER', reduced ? 699 : 1499),
      planId: getPlanId('POWER'),
    },
  };
}

function buildPlanTypeLookup() {
  const byId = new Map();
  ['full', 'reduced'].forEach((region) => {
    const conf = buildPlanConfig(region);
    Object.entries(conf).forEach(([planType, meta]) => {
      if (meta.planId) byId.set(meta.planId, planType);
    });
  });
  return byId;
}

const PLAN_TYPE_BY_ID = buildPlanTypeLookup();

function normalizePlanType(input) {
  const value = String(input || '').toLowerCase();
  if (value === 'starter' || value === 'pro' || value === 'power') return value;
  return 'pro';
}

function getPlanTypeFromPlanId(planId) {
  if (!planId) return null;
  const mapped = PLAN_TYPE_BY_ID.get(planId);
  if (mapped) return mapped;
  const normalized = String(planId).toLowerCase();
  if (normalized.includes('starter')) return 'starter';
  if (normalized.includes('power')) return 'power';
  if (normalized.includes('pro')) return 'pro';
  return null;
}

/**
 * Calculate period end from plan.
 * Used as a fallback when Razorpay doesn't return current_end.
 */
function calcPeriodEnd(planId) {
  const planType = getPlanTypeFromPlanId(planId);
  const plan = buildPlanConfig('full')[planType] || buildPlanConfig('reduced')[planType];
  const months = plan?.periodMonths || 1;
  const end = new Date();
  end.setMonth(end.getMonth() + months);
  return end;
}

// ─── Checkout ─────────────────────────────────────────────────────────────────

async function createCheckoutSession(userId, email, displayName, requestedPlanId, options = {}) {
  const pendingPlanType = normalizePlanType(requestedPlanId);
  const pricingRegion = normalizePricingRegion(options.pricingRegion);
  const planConfig = buildPlanConfig(pricingRegion);
  const planMeta = planConfig[pendingPlanType] || planConfig.pro;
  const planId = planMeta.planId;

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id:         planId,
      customer_notify: 1,
      quantity:        1,
      total_count:     planMeta.totalCount,
      notes:           { userId, email, planId, planType: pendingPlanType, pricingRegion },
    });

    // Store subscription ID in BOTH columns so webhooks can find it
    // regardless of whether verify has been called yet (race condition fix).
    await query(
      `INSERT INTO subscription_status
         (user_id, stripe_customer_id, stripe_subscription_id, plan, status, pending_plan_type)
       VALUES ($1, $2, $2, 'free', 'pending', $3)
       ON CONFLICT (user_id) DO UPDATE
         SET stripe_customer_id    = $2,
             stripe_subscription_id = $2,
             pending_plan_type      = $3,
             updated_at            = NOW()`,
      [userId, subscription.id, pendingPlanType]
    );

    logger.info('Checkout session created', {
      userId,
      subscriptionId: subscription.id,
      planId,
      planLabel: planMeta.label,
      pricingRegion,
    });

    return {
      subscriptionId: subscription.id,
      keyId:          process.env.RAZORPAY_KEY_ID,
      amount:         planMeta.amountPaise,
      currency:       'INR',
      name:           'Smart Mailbox Cleaner',
      description:    `${planMeta.label} Plan`,
      email,
      planType:       pendingPlanType,
      pricingRegion,
    };
  } catch (err) {
    logger.error('Failed to create checkout session', err, { userId, email, planId });
    throw err;
  }
}

// ─── Payment Verification ─────────────────────────────────────────────────────

async function verifyAndActivatePayment(userId, {
  razorpay_payment_id,
  razorpay_subscription_id,
  razorpay_signature,
}) {
  try {
    // Verify HMAC signature — always non-negotiable
    const body = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      throw new Error('Payment signature verification failed.');
    }

    // Fetch the subscription from Razorpay to get the actual plan and period end.
    // This avoids trusting any frontend-sent plan information for security.
    let periodEnd;
    let detectedPlanId;
    try {
      const rzpSub = await razorpay.subscriptions.fetch(razorpay_subscription_id);
      detectedPlanId = rzpSub.plan_id;
      // Razorpay returns current_end as a Unix timestamp
      if (rzpSub.current_end) {
        periodEnd = new Date(rzpSub.current_end * 1000);
      } else {
        periodEnd = calcPeriodEnd(detectedPlanId);
      }
    } catch (fetchErr) {
      logger.warn('Could not fetch subscription from Razorpay — using plan-based period', {
        err: fetchErr.message,
      });
      periodEnd = calcPeriodEnd(buildPlanConfig('full').pro.planId);
    }

    const pendingRes = await query(
      `SELECT pending_plan_type
       FROM subscription_status
       WHERE user_id = $1`,
      [userId]
    );
    const detectedPlanType = getPlanTypeFromPlanId(detectedPlanId);
    const planType = normalizePlanType(pendingRes.rows[0]?.pending_plan_type || detectedPlanType);

    await applyPurchasedPlan(userId, planType);

    await query(
      `UPDATE subscription_status
       SET plan                   = $4,
           status                 = 'active',
           stripe_subscription_id  = $1,
           current_period_end     = $2,
           pending_plan_type      = NULL,
           updated_at             = NOW()
       WHERE user_id = $3`,
      [razorpay_subscription_id, periodEnd, userId, planType]
    );

    logger.info('Razorpay subscription activated via verify', {
      userId,
      razorpay_subscription_id,
      detectedPlanId,
      planType,
      periodEnd,
    });

    return { success: true };
  } catch (err) {
    logger.error('Payment verification failed', err, { userId });
    throw err;
  }
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────

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

      // ── Subscription activated / renewed ─────────────────────────────────
      case 'subscription.activated':
      case 'subscription.charged': {
        const sub = event.payload.subscription.entity;
        const inferredPlanType = normalizePlanType(getPlanTypeFromPlanId(sub.plan_id) || 'pro');
        const periodEnd = sub.current_end
          ? new Date(sub.current_end * 1000)
          : calcPeriodEnd(sub.plan_id);

        const result = await query(
          `UPDATE subscription_status
           SET plan                   = COALESCE(pending_plan_type, $3),
               status                 = 'active',
               stripe_subscription_id  = $1,
               current_period_end     = $2,
               pending_plan_type      = NULL,
               updated_at             = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id, plan`,
          [sub.id, periodEnd, inferredPlanType]
        );

        if (result.rowCount === 0) {
          logger.warn('Webhook: no subscription record found to activate', { subId: sub.id });
        } else {
          await applyPurchasedPlan(result.rows[0].user_id, normalizePlanType(result.rows[0].plan));
          logger.info('Webhook: subscription activated/renewed', {
            subId: sub.id,
            userId: result.rows[0].user_id,
            planType: result.rows[0].plan,
            planId: sub.plan_id,
            periodEnd,
          });
        }
        break;
      }

      // ── Cancelled — keep paid access until period ends (grace period) ─────
      case 'subscription.cancelled': {
        const sub = event.payload.subscription.entity;

        const result = await query(
          `UPDATE subscription_status
           SET status     = 'canceled',
               updated_at = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id, current_period_end`,
          [sub.id]
        );

        if (result.rowCount > 0) {
          logger.info('Webhook: subscription cancelled — paid access kept until period end', {
            userId:      result.rows[0].user_id,
            accessUntil: result.rows[0].current_period_end,
          });
        }
        break;
      }

      // ── Fully expired after cancel ────────────────────────────────────────
      case 'subscription.expired': {
        const sub = event.payload.subscription.entity;

        const result = await query(
          `UPDATE subscription_status
           SET plan       = 'free',
               status     = 'canceled',
               updated_at = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id`,
          [sub.id]
        );

        if (result.rowCount > 0) {
          logger.info('Webhook: subscription expired — downgraded to free', {
            userId: result.rows[0].user_id,
          });
        }
        break;
      }

      // ── Halted (payment failed after retries) → immediate downgrade ───────
      case 'subscription.halted': {
        const sub = event.payload.subscription.entity;

        const result = await query(
          `UPDATE subscription_status
           SET plan       = 'free',
               status     = 'past_due',
               updated_at = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id`,
          [sub.id]
        );

        if (result.rowCount > 0) {
          logger.warn('Webhook: subscription halted — downgraded to free', {
            userId: result.rows[0].user_id,
          });
        }
        break;
      }

      // ── Individual payment failed (retries still pending) → mark past_due ─
      case 'payment.failed': {
        const payment = event.payload.payment?.entity;
        const subId   = payment?.subscription_id;

        if (!subId) { logger.warn('payment.failed: no subscription_id'); break; }

        const result = await query(
          `UPDATE subscription_status
           SET status     = 'past_due',
               updated_at = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id`,
          [subId]
        );

        if (result.rowCount > 0) {
          logger.warn('Webhook: payment failed — marked past_due (Razorpay will retry)', {
            userId:    result.rows[0].user_id,
            paymentId: payment?.id,
          });
        }
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

// ─── Portal ───────────────────────────────────────────────────────────────────
// Razorpay has no hosted portal — redirect to in-app subscription management.

async function createPortalSession(userId) {
  return { url: `${process.env.FRONTEND_URL}/dashboard?manage=subscription` };
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function getSubscriptionStatus(userId) {
  try {
    const usageRes = await query(
      `SELECT plan_type, plan_expiry
       FROM users
       WHERE id = $1`,
      [userId]
    );
    const usage = usageRes.rows[0] || {};
    const isPowerActive = usage.plan_type === 'power' && usage.plan_expiry && new Date(usage.plan_expiry) > new Date();

    const result = await query(
      `SELECT plan, status, current_period_end FROM subscription_status WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows[0]) {
      const paid = isPowerActive || usage.plan_type === 'starter' || usage.plan_type === 'pro';
      return { plan: usage.plan_type || 'free', status: 'active', isPro: paid, planExpiry: usage.plan_expiry || null };
    }

    const row = result.rows[0];
    const inGracePeriod =
      row.status === 'canceled' &&
      row.current_period_end &&
      new Date(row.current_period_end) > new Date();

    const isPro = isPowerActive || usage.plan_type === 'starter' || usage.plan_type === 'pro' || ((row.plan === 'pro' && row.status === 'active') || inGracePeriod);

    return {
      plan:             usage.plan_type || row.plan,
      status:           row.status,
      currentPeriodEnd: row.current_period_end,
      planExpiry:       usage.plan_expiry || null,
      isPro,
      inGracePeriod,
    };
  } catch (err) {
    logger.error('Failed to get subscription status', err, { userId });
    return { plan: 'free', status: 'active', isPro: false };
  }
}

// ─── Cancel Subscription (admin-initiated) ────────────────────────────────────
// Cancels the Razorpay subscription immediately and downgrades DB to free.
// cancel_at_cycle_end = false means cancel NOW (not at period end).

async function cancelSubscription(userId) {
  const result = await query(
    `SELECT stripe_subscription_id, current_period_end
     FROM subscription_status WHERE user_id = $1`,
    [userId]
  );

  const row = result.rows[0];
  const subscriptionId = row?.stripe_subscription_id;

  // Cancel on Razorpay if there's a real subscription ID
  if (subscriptionId && !subscriptionId.startsWith('plan_')) {
    try {
      await razorpay.subscriptions.cancel(subscriptionId, false);
      logger.info('Razorpay subscription cancelled by admin', { userId, subscriptionId });
    } catch (err) {
      // Log but don't throw — still downgrade DB even if Razorpay call fails
      // (subscription may already be cancelled/expired on Razorpay side)
      logger.warn('Razorpay cancel call failed (proceeding with DB downgrade)', {
        userId, subscriptionId, err: err.message,
      });
    }
  }

  // Always downgrade DB regardless of Razorpay outcome
  await query(
    `UPDATE subscription_status
     SET plan = 'free', status = 'canceled', updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );

  return { cancelled: true, subscriptionId };
}

module.exports = {
  createCheckoutSession,
  verifyAndActivatePayment,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
  cancelSubscription,
};
