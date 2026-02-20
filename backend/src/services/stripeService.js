// src/services/stripeService.js
const stripe = require('../config/stripe');
const { query } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Create or retrieve a Stripe customer for a user.
 */
async function getOrCreateCustomer(userId, email, displayName) {
  // Check if customer already exists
  const result = await query(
    'SELECT stripe_customer_id FROM subscription_status WHERE user_id = $1',
    [userId]
  );

  if (result.rows[0]?.stripe_customer_id) {
    return result.rows[0].stripe_customer_id;
  }

  const customer = await stripe.customers.create({
    email,
    name: displayName,
    metadata: { userId },
  });

  // Upsert subscription_status record
  await query(
    `INSERT INTO subscription_status (user_id, stripe_customer_id, plan, status)
     VALUES ($1, $2, 'free', 'active')
     ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = $2`,
    [userId, customer.id]
  );

  return customer.id;
}

/**
 * Create a Stripe Checkout session for Pro subscription.
 */
async function createCheckoutSession(userId, email, displayName) {
  const customerId = await getOrCreateCustomer(userId, email, displayName);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: process.env.STRIPE_PRO_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/dashboard?upgrade=success`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing?upgrade=cancelled`,
    subscription_data: {
      metadata: { userId },
      trial_period_days: 0,
    },
    allow_promotion_codes: true,
    metadata: { userId },
  });

  return { sessionId: session.id, url: session.url };
}

/**
 * Create a Stripe Customer Portal session for managing subscription.
 */
async function createPortalSession(userId) {
  const result = await query(
    'SELECT stripe_customer_id FROM subscription_status WHERE user_id = $1',
    [userId]
  );

  if (!result.rows[0]?.stripe_customer_id) {
    throw new Error('No Stripe customer found. Please subscribe first.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: result.rows[0].stripe_customer_id,
    return_url: `${process.env.FRONTEND_URL}/dashboard`,
  });

  return { url: session.url };
}

/**
 * Handle Stripe webhooks — subscription lifecycle events.
 * Call with raw body Buffer and signature header.
 */
async function handleWebhook(rawBody, signature) {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', err);
    throw new Error(`Webhook signature invalid: ${err.message}`);
  }

  logger.info('Stripe webhook received', { type: event.type });

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode === 'subscription') {
        await activateSubscription(session);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      await updateSubscriptionStatus(sub);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await cancelSubscription(sub);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      await markPastDue(invoice);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await renewSubscription(invoice);
      }
      break;
    }

    default:
      logger.info('Unhandled Stripe event type', { type: event.type });
  }

  return { received: true };
}

async function activateSubscription(session) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  const subscription = await stripe.subscriptions.retrieve(session.subscription);

  await query(
    `UPDATE subscription_status
     SET plan = 'pro',
         status = $1,
         stripe_subscription_id = $2,
         current_period_end = to_timestamp($3)
     WHERE user_id = $4`,
    [
      subscription.status,
      subscription.id,
      subscription.current_period_end,
      userId,
    ]
  );

  logger.info('Subscription activated', { userId, subscriptionId: subscription.id });
}

async function updateSubscriptionStatus(subscription) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  await query(
    `UPDATE subscription_status
     SET status = $1,
         current_period_end = to_timestamp($2),
         plan = $3
     WHERE stripe_subscription_id = $4`,
    [
      subscription.status,
      subscription.current_period_end,
      subscription.status === 'active' ? 'pro' : 'free',
      subscription.id,
    ]
  );
}

async function cancelSubscription(subscription) {
  await query(
    `UPDATE subscription_status
     SET plan = 'free', status = 'canceled'
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );
  logger.info('Subscription canceled', { subscriptionId: subscription.id });
}

async function markPastDue(invoice) {
  if (!invoice.subscription) return;
  await query(
    `UPDATE subscription_status SET status = 'past_due' WHERE stripe_subscription_id = $1`,
    [invoice.subscription]
  );
}

async function renewSubscription(invoice) {
  if (!invoice.subscription) return;
  const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
  await query(
    `UPDATE subscription_status
     SET status = 'active',
         current_period_end = to_timestamp($1)
     WHERE stripe_subscription_id = $2`,
    [subscription.current_period_end, invoice.subscription]
  );
}

/**
 * Get subscription status for a user
 */
async function getSubscriptionStatus(userId) {
  const result = await query(
    `SELECT plan, status, current_period_end, stripe_customer_id
     FROM subscription_status WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { plan: 'free', status: 'active', currentPeriodEnd: null };
  }

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
  createPortalSession,
  handleWebhook,
  getSubscriptionStatus,
  getOrCreateCustomer,
};
