// src/services/stripeService.js (Razorpay version)
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
 * Create a Razorpay subscription plan (run once to set up)
 */
async function getOrCreatePlan() {
  const planId = process.env.RAZORPAY_PLAN_ID;
  if (planId) return planId;
  
  const plan = await razorpay.plans.create({
    period: 'monthly',
    interval: 1,
    item: {
      name: 'Smart Mailbox Cleaner Pro',
      amount: PLAN_AMOUNT,
      currency: 'INR',
      description: 'Pro monthly subscription',
    },
  });
  
  logger.info('Created Razorpay plan', { planId: plan.id });
  return plan.id;
}

/**
 * Create a Razorpay subscription for a user.
 * Returns subscription ID — frontend uses this with Razorpay.js to collect payment.
 */
async function createCheckoutSession(userId, email, displayName) {
  const planId = await getOrCreatePlan();

  const subscription = await razorpay.subscriptions.create({
    plan_id: planId,
    customer_notify: 1,
    quantity: 1,
    total_count: 12, // 12 months, then auto-renews
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

  return {
    subscriptionId: subscription.id,
    keyId: process.env.RAZORPAY_KEY_ID,
    amount: PLAN_AMOUNT,
    currency: 'INR',
    name: 'Smart Mailbox Cleaner Pro',
    email,
  };
}

/**
 * Verify Razorpay payment signature (called after frontend payment success)
 */
async function verifyAndActivatePayment(userId, { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }) {
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
}

/**
 * Handle Razorpay webhooks
 */
async function handleWebhook(rawBody, signature) {
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
}

async function createPortalSession(userId) {
  // Razorpay has no hosted portal — direct users to contact support or cancel via API
  return { url: `${process.env.FRONTEND_URL}/dashboard?manage=subscription` };
}

async function getSubscriptionStatus(userId) {
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
}

module.exports = {
  createCheckoutSession,
  verifyAndActivatePayment,
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
};
