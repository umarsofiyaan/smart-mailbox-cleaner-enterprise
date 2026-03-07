import { subscriptionApi } from '../api/client';

let scriptPromise = null;

function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

  return scriptPromise;
}

export async function launchRazorpayCheckout(planType) {
  const loaded = await loadRazorpayScript();
  if (!loaded || !window.Razorpay) {
    throw new Error('Failed to load Razorpay checkout.');
  }

  const checkoutRes = await subscriptionApi.createCheckout({ planType });
  const data = checkoutRes.data || {};

  return new Promise((resolve, reject) => {
    const options = {
      key: data.keyId,
      subscription_id: data.subscriptionId,
      name: data.name || 'Smart Mailbox Cleaner',
      description: data.description || 'Plan purchase',
      prefill: { email: data.email || undefined },
      theme: { color: '#2563eb' },
      handler: async (response) => {
        try {
          await subscriptionApi.verifyPayment({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id,
            razorpay_signature: response.razorpay_signature,
          });
          resolve(response);
        } catch (err) {
          reject(err);
        }
      },
      modal: {
        ondismiss: () => reject(new Error('Checkout canceled.')),
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (resp) => {
      const msg = resp?.error?.description || 'Payment failed.';
      reject(new Error(msg));
    });
    rzp.open();
  });
}
