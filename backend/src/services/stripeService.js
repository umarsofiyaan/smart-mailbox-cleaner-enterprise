// src/services/stripeService.js (Razorpay)
// Handles subscription lifecycle: checkout, payment verification, webhooks, status.

const Razorpay = require('razorpay');
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_AMOUNT = 50000; // ₹500 in paise

// ─── Checkout ────────────────────────────────────────────────────────────────

async function createCheckoutSession(userId, email, displayName) {
  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      quantity: 1,
      total_count: 12,
      notes: { userId, email },
    });

    // Store the Razorpay subscription ID in BOTH columns so webhooks
    // can find the record regardless of whether verify has been called yet.
    // FIX: Previously only stored in stripe_customer_id, so webhook lookup
    // by stripe_subscription_id always failed (race condition).
    await query(
      `INSERT INTO subscription_status
         (user_id, stripe_customer_id, stripe_subscription_id, plan, status)
       VALUES ($1, $2, $2, 'free', 'pending')
       ON CONFLICT (user_id) DO UPDATE
         SET stripe_customer_id = $2,
             stripe_subscription_id = $2,
             updated_at = NOW()`,
      [userId, subscription.id]
    );

    logger.info('Checkout session created', { userId, subscriptionId: subscription.id });

    return {
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: PLAN_AMOUNT,
      currency: 'INR',
      name: 'Smart Mailbox Cleaner Pro',
      email,
    };
  } catch (err) {
    logger.error('Failed to create checkout session', err, { userId, email });
    throw err;
  }
}

// ─── Payment Verification (called by frontend after successful payment) ───────

async function verifyAndActivatePayment(userId, {
  razorpay_payment_id,
  razorpay_subscription_id,
  razorpay_signature,
}) {
  try {
    // Verify HMAC signature
    const body = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      throw new Error('Payment signature verification failed.');
    }

    // Set period end to +1 month from now
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await query(
      `UPDATE subscription_status
       SET plan                  = 'pro',
           status                = 'active',
           stripe_subscription_id = $1,
           current_period_end    = $2,
           updated_at            = NOW()
       WHERE user_id = $3`,
      [razorpay_subscription_id, periodEnd, userId]
    );

    logger.info('Razorpay subscription activated via verify', {
      userId,
      razorpay_subscription_id,
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
    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new Error('Webhook signature invalid.');
    }

    const event = JSON.parse(rawBody);
    logger.info('Razorpay webhook received', { event: event.event });

    switch (event.event) {

      // ── Payment succeeded / subscription renewed ──────────────────────────
      case 'subscription.activated':
      case 'subscription.charged': {
        const sub = event.payload.subscription.entity;
        const periodEnd = new Date(sub.current_end * 1000);

        // FIX: Match by stripe_subscription_id OR stripe_customer_id.
        // Before `verify` is called, stripe_subscription_id might differ
        // from what was stored. This ensures the record is always found.
        const result = await query(
          `UPDATE subscription_status
           SET plan                  = 'pro',
               status                = 'active',
               stripe_subscription_id = $1,
               current_period_end    = $2,
               updated_at            = NOW()
           WHERE stripe_subscription_id = $1
              OR stripe_customer_id     = $1
           RETURNING user_id`,
          [sub.id, periodEnd]
        );

        if (result.rowCount === 0) {
          logger.warn('Webhook: no subscription record found to activate', { subId: sub.id });
        } else {
          logger.info('Webhook: subscription activated/renewed', {
            subId: sub.id,
            userId: result.rows[0].user_id,
            periodEnd,
          });
        }
        break;
      }

      // ── Subscription cancelled by user ────────────────────────────────────
      // Grace period: keep Pro until current_period_end (they paid for the month).
      // A separate daily cron (in worker.js) downgrades after period_end passes.
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
          const { user_id, current_period_end } = result.rows[0];
          logger.info('Webhook: subscription cancelled — Pro access until period end', {
            userId: user_id,
            accessUntil: current_period_end,
          });
        }
        break;
      }

      // ── Subscription fully expired (period ended after cancel) ────────────
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

      // ── Payment failed — subscription halted ──────────────────────────────
      // FIX: Previously only set status='past_due' but left plan='pro'.
      // Now immediately downgrades to free. Razorpay halts after retries fail,
      // so there's no point keeping Pro access at this stage.
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
          logger.warn('Webhook: subscription halted (payment failed) — downgraded to free', {
            userId: result.rows[0].user_id,
          });
        }
        break;
      }

      // ── Individual payment failed (fired before halted, during retries) ───
      // FIX: Was completely unhandled. Set status to past_due but keep plan
      // for now — Razorpay will retry. Only fully downgrade on 'halted'.
      case 'payment.failed': {
        const payment = event.payload.payment?.entity;
        const subId = payment?.subscription_id;

        if (!subId) {
          logger.warn('payment.failed: no subscription_id in payload');
          break;
        }

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
            userId: result.rows[0].user_id,
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

// ─── Portal (Razorpay has no hosted portal — send to dashboard) ──────────────

async function createPortalSession(userId) {
  return { url: `${process.env.FRONTEND_URL}/dashboard?manage=subscription` };
}

// ─── Status ───────────────────────────────────────────────────────────────────

async function getSubscriptionStatus(userId) {
  try {
    const result = await query(
      `SELECT plan, status, current_period_end FROM subscription_status WHERE user_id = $1`,
      [userId]
    );

    if (!result.rows[0]) return { plan: 'free', status: 'active', isPro: false };

    const row = result.rows[0];

    // Grace period check: if cancelled but period hasn't ended yet, still treat as Pro
    const inGracePeriod =
      row.status === 'canceled' &&
      row.current_period_end &&
      new Date(row.current_period_end) > new Date();

    const isPro =
      (row.plan === 'pro' && row.status === 'active') || inGracePeriod;

    return {
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      isPro,
      inGracePeriod,
    };
  } catch (err) {
    logger.error('Failed to get subscription status', err, { userId });
    return { plan: 'free', status: 'active', isPro: false };
  }
}

module.exports = {
  createCheckoutSession,
  verifyAndActivatePayment,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
};
