// src/services/stripeService.js (Razorpay version - simplified)
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const PLAN_AMOUNT = 500; // ₹5 in paise (500 paise = ₹5)

/**
 * Create a Razorpay subscription for a user.
 * Returns subscription ID — frontend uses this with Razorpay.js to collect payment.
 */
async function createCheckoutSession(userId, email, displayName) {
  try {
    // For testing, use a simple subscription creation
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID || 'plan_00000000000001',
      customer_notify: 1,
      quantity: 1,
      total_count: 12,
      notes: {
        userId,
        email,
      },
    });

    // Store pending subscription
    await query(
      `INSERT INTO subscription_status (user_id, stripe_customer_id, plan, status)
       VALUES ($1, $2, 'free', 'pending')
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = $2`,
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

/**
 * Verify Razorpay payment signature (called after frontend payment success)
 */
async function verifyAndActivatePayment(userId, { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }) {
  try {
    // Verify signature
    const body = razorpay_payment_id + '|' + razorpay_subscription_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      throw new Error('Payment signature verification failed.');
    }

    // Activate subscription
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    await query(
      `UPDATE subscription_status
       SET plan = 'pro',
           status = 'active',
           stripe_subscription_id = $1,
           current_period_end = $2
       WHERE user_id = $3`,
      [razorpay_subscription_id, periodEnd, userId]
    );

    logger.info('Razorpay subscription activated', { userId, razorpay_subscription_id });
    return { success: true };
  } catch (err) {
    logger.error('Payment verification failed', err, { userId });
    throw err;
  }
}

/**
 * Handle Razorpay webhooks
 */
async function handleWebhook(rawBody, signature) {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      throw new Error('Webhook signature invalid.');
    }

    const event = JSON.parse(rawBody);
    logger.info('Razorpay webhook', { event: event.event });

    switch (event.event) {
      case 'subscription.activated':
      case 'subscription.charged': {
        const sub = event.payload.subscription.entity;
        const periodEnd = new Date(sub.current_end * 1000);
        await query(
          `UPDATE subscription_status
           SET plan = 'pro', status = 'active', current_period_end = $1
           WHERE stripe_subscription_id = $2`,
          [periodEnd, sub.id]
        );
        break;
      }
      case 'subscription.cancelled':
      case 'subscription.expired': {
        const sub = event.payload.subscription.entity;
        await query(
          `UPDATE subscription_status SET plan = 'free', status = 'canceled'
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
        break;
      }
      case 'subscription.halted': {
        const sub = event.payload.subscription.entity;
        await query(
          `UPDATE subscription_status SET status = 'past_due'
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
        break;
      }
    }

    return { received: true };
  } catch (err) {
    logger.error('Webhook handling failed', err);
    throw err;
  }
}

async function createPortalSession(userId) {
  return { url: `${process.env.FRONTEND_URL}/dashboard?manage=subscription` };
}

async function getSubscriptionStatus(userId) {
  try {
    const result = await query(
      `SELECT plan, status, current_period_end FROM subscription_status WHERE user_id = $1`,
      [userId]
    );
    if (!result.rows[0]) return { plan: 'free', status: 'active', isPro: false };
    const row = result.rows[0];
    return {
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: row.current_period_end,
      isPro: row.plan === 'pro' && row.status === 'active',
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
