// src/utils/razorpayCheckout.js
// Launches the Razorpay one-time payment modal.
// Uses order_id (NOT subscription_id) — no recurring billing.
//
// Flow:
//   1. POST /subscription/checkout → backend creates a Razorpay Order → returns orderId
//   2. Open Razorpay modal with order_id
//   3. On success: POST /subscription/verify with payment_id + order_id + signature
//   4. Backend verifies HMAC and grants plan credits

import { subscriptionApi } from '../api/client';

let scriptPromise = null;

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export async function launchRazorpayCheckout(planType) {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Failed to load Razorpay checkout. Please check your internet connection and try again.');
  }

  // Step 1 — create a Razorpay Order on the backend
  const checkoutRes = await subscriptionApi.createCheckout({ planType });
  const data = checkoutRes.data || {};

  if (!data.orderId) {
    throw new Error('Could not create payment session. Please try again.');
  }

  return new Promise((resolve, reject) => {
    const options = {
      key:         data.keyId,
      order_id:    data.orderId,          // ← one-time order (NOT subscription_id)
      amount:      data.amount,
      currency:    data.currency || 'INR',
      name:        data.name        || 'Smart Mailbox Cleaner',
      description: data.description || 'Plan purchase',
      prefill: {
        email: data.email || undefined,
      },
      theme: { color: '#2563eb' },

      handler: async (response) => {
        // Step 2 — verify the payment on the backend
        // response contains: razorpay_payment_id, razorpay_order_id, razorpay_signature
        try {
          await subscriptionApi.verifyPayment({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id:   response.razorpay_order_id,   // ← order-based verify
            razorpay_signature:  response.razorpay_signature,
          });
          resolve(response);
        } catch (err) {
          reject(err);
        }
      },

      modal: {
        ondismiss: () => reject(new Error('Checkout cancelled.')),
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (resp) => {
      const msg = resp?.error?.description || resp?.error?.reason || 'Payment failed. Please try again.';
      reject(new Error(msg));
    });
    rzp.open();
  });
}
