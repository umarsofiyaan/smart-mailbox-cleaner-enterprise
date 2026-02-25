// src/pages/Pricing.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscriptionApi } from '../api/client';
import { useAuth } from '../hooks/useAuth.jsx';

// ── Plan definitions ──────────────────────────────────────────────────────────
// planId values must match the Razorpay plan IDs you created.
// The backend reads RAZORPAY_PLAN_ID_MONTHLY / _3MONTHS / _6MONTHS / _YEARLY env vars.

const PLANS = [
  {
    id:           'monthly',
    razorpayKey:  'MONTHLY',
    planId:       import.meta.env.VITE_RAZORPAY_PLAN_ID_MONTHLY || null,
    label:        'Monthly',
    price:        449,
    perMonth:     449,
    period:       'per month',
    savingsPct:   null,
    savingsLabel: null,
    badge:        null,
    totalCount:   '12 payments',
  },
  {
    id:           '3months',
    razorpayKey:  '3MONTHS',
    planId:       import.meta.env.VITE_RAZORPAY_PLAN_ID_3MONTHS || null,
    label:        '3 Months',
    price:        1299,
    perMonth:     433,
    period:       'per 3 months',
    savingsPct:   3,
    savingsLabel: 'Save ₹48 vs monthly',
    badge:        null,
    totalCount:   '4 payments',
  },
  {
    id:           '6months',
    razorpayKey:  '6MONTHS',
    planId:       import.meta.env.VITE_RAZORPAY_PLAN_ID_6MONTHS || null,
    label:        '6 Months',
    price:        2499,
    perMonth:     416,
    period:       'per 6 months',
    savingsPct:   7,
    savingsLabel: 'Save ₹195 vs monthly',
    badge:        'Popular',
    totalCount:   '2 payments',
  },
  {
    id:           'yearly',
    razorpayKey:  'YEARLY',
    planId:       import.meta.env.VITE_RAZORPAY_PLAN_ID_YEARLY || null,
    label:        'Yearly',
    price:        4499,
    perMonth:     375,
    period:       'per year',
    savingsPct:   16,
    savingsLabel: 'Save ₹889 vs monthly',
    badge:        'Best Value',
    totalCount:   'Annual payment',
  },
];

const FREE_FEATURES = [
  'Scan last 12 months',
  '500 lifetime cleanup credits',
  '50 free credits/day after',
  'View confidence scores',
  'Storage usage dashboard',
];

const PRO_FEATURES = [
  'Everything in Free',
  'Full mailbox scan (all years)',
  'Custom scan — filter by date, size, sender',
  'Unlimited bulk cleanup',
  'Undo any cleanup for 30 days',
  'Priority support',
];

// ── Razorpay checkout helper ──────────────────────────────────────────────────

async function openRazorpay({ subscriptionId, keyId, amount, currency, email, description }) {
  await new Promise((resolve, reject) => {
    if (window.Razorpay) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload  = resolve;
    script.onerror = () => reject(new Error('Failed to load Razorpay'));
    document.body.appendChild(script);
  });

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key:             keyId,
      subscription_id: subscriptionId,
      name:            'Smart Mailbox Cleaner',
      description,
      amount,
      currency,
      prefill:         { email },
      theme:           { color: '#2563eb' },
      handler:         resolve,
      modal:           { ondismiss: () => reject(new Error('Payment cancelled')) },
    });
    rzp.open();
  });
}

// ── PlanCard ─────────────────────────────────────────────────────────────────

function PlanCard({ plan, isCurrentPlan, onUpgrade, loading }) {
  const isHighlighted = plan.id === 'yearly' || plan.id === '6months';
  const isBestValue   = plan.id === 'yearly';

  return (
    <div className={`relative flex flex-col rounded-2xl border p-6 transition-all duration-200 ${
      isBestValue
        ? 'bg-brand-600 border-brand-600 text-white shadow-xl scale-[1.02]'
        : isHighlighted
        ? 'bg-white border-brand-300 shadow-lg ring-1 ring-brand-200'
        : 'bg-white border-gray-200 shadow-sm hover:shadow-md hover:border-gray-300'
    }`}>

      {/* Badge */}
      {plan.badge && (
        <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
          isBestValue ? 'bg-yellow-400 text-yellow-900' : 'bg-brand-600 text-white'
        }`}>
          {plan.badge}
        </div>
      )}

      {/* Label */}
      <p className={`text-sm font-bold uppercase tracking-widest mb-3 ${
        isBestValue ? 'text-brand-200' : 'text-gray-400'
      }`}>
        {plan.label}
      </p>

      {/* Price */}
      <div className="mb-1">
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-extrabold ${isBestValue ? 'text-white' : 'text-gray-900'}`}>
            ₹{plan.price.toLocaleString('en-IN')}
          </span>
        </div>
        <p className={`text-sm mt-0.5 ${isBestValue ? 'text-brand-200' : 'text-gray-400'}`}>
          {plan.period}
        </p>
      </div>

      {/* Effective monthly rate */}
      <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full mb-4 w-fit ${
        isBestValue
          ? 'bg-brand-500 text-brand-100'
          : 'bg-gray-100 text-gray-600'
      }`}>
        ₹{plan.perMonth}/mo effective
      </div>

      {/* Savings label */}
      {plan.savingsLabel && (
        <p className={`text-xs font-semibold mb-4 ${isBestValue ? 'text-yellow-300' : 'text-green-600'}`}>
          ✓ {plan.savingsLabel}
        </p>
      )}

      {/* Total count note */}
      <p className={`text-xs mb-5 ${isBestValue ? 'text-brand-300' : 'text-gray-400'}`}>
        {plan.totalCount}
      </p>

      {/* CTA */}
      <div className="mt-auto">
        {isCurrentPlan ? (
          <div className={`text-center py-3 rounded-xl text-sm font-semibold ${
            isBestValue ? 'bg-brand-500 text-brand-100' : 'bg-green-50 text-green-700'
          }`}>
            ✓ Current plan
          </div>
        ) : (
          <button
            onClick={() => onUpgrade(plan)}
            disabled={loading === plan.id}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-60 flex items-center justify-center gap-2 ${
              isBestValue
                ? 'bg-white text-brand-700 hover:bg-brand-50'
                : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {loading === plan.id ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Opening…
              </>
            ) : (
              'Subscribe'
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(null); // plan.id of the plan being loaded
  const [error,   setError]   = useState('');

  const isPro = user?.subscription?.isPro;

  async function handleUpgrade(plan) {
    if (!user) { navigate('/login'); return; }
    if (isPro)  { navigate('/dashboard?manage=subscription'); return; }

    setLoading(plan.id);
    setError('');

    try {
      // Pass the plan ID to the backend so it creates the right Razorpay subscription.
      // The backend resolves the actual Razorpay plan_id from env vars using the razorpayKey.
      const response = await subscriptionApi.createCheckout({ planId: plan.planId });
      const { subscriptionId, keyId, amount, currency, email, description } = response.data;

      const paymentResult = await openRazorpay({
        subscriptionId,
        keyId,
        amount,
        currency,
        email: email || user.email,
        description: description || `Pro ${plan.label} Plan`,
      });

      // Verify on backend
      await fetch(`${import.meta.env.VITE_API_URL}/subscription/verify`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify(paymentResult),
      });

      navigate('/dashboard?upgrade=success');
    } catch (err) {
      if (err.message !== 'Payment cancelled') {
        setError(err.message || 'Payment failed. Please try again.');
      }
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="border-b border-gray-100 bg-white px-6 py-4 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button
            onClick={() => navigate(user ? '/dashboard' : '/')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm font-medium">{user ? 'Back to Dashboard' : 'Back'}</span>
          </button>
          <div className="flex items-center gap-2">
            <img src="/icon-72.png" alt="" className="w-7 h-7 rounded-lg" />
            <span className="font-bold text-gray-900 text-sm">Smart Mailbox Cleaner</span>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-14">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-gray-900 mb-3">
            Simple, honest pricing
          </h1>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            Start free. Pick a Pro plan when you're ready — cancel anytime.
          </p>
        </div>

        {/* ── Error ─────────────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-8 text-center">
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        {/* ── Free vs Pro overview ──────────────────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-6 mb-10 max-w-3xl mx-auto">

          {/* Free */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Free</p>
            <div className="flex items-baseline gap-1 mb-5">
              <span className="text-4xl font-extrabold text-gray-900">₹0</span>
              <span className="text-gray-400 text-sm">/forever</span>
            </div>
            <ul className="space-y-2.5 mb-6">
              {FREE_FEATURES.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-gray-300 mt-0.5 flex-shrink-0">✓</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate(user ? '/dashboard' : '/login')}
              className="w-full py-3 rounded-xl border-2 border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 text-sm transition-colors"
            >
              {user ? 'Go to Dashboard' : 'Get started free'}
            </button>
          </div>

          {/* Pro features list */}
          <div className="bg-gradient-to-br from-brand-50 to-indigo-50 border border-brand-100 rounded-2xl p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-500 mb-3">Pro</p>
            <p className="text-sm font-bold text-gray-900 mb-4">Everything in Free, plus:</p>
            <ul className="space-y-2.5">
              {PRO_FEATURES.slice(1).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="text-brand-500 mt-0.5 flex-shrink-0 font-bold">✓</span> {f}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── 4 plan cards ──────────────────────────────────────────────────── */}
        <div>
          <p className="text-center text-sm font-semibold text-gray-500 mb-6 uppercase tracking-widest">
            Choose your Pro billing period
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
            {PLANS.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isCurrentPlan={isPro}
                onUpgrade={handleUpgrade}
                loading={loading}
              />
            ))}
          </div>
        </div>

        {/* ── Money back note ───────────────────────────────────────────────── */}
        <p className="text-center text-xs text-gray-400 mt-6">
          100% refund within 7 days · Cancel anytime · No questions asked
        </p>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Common questions</h2>
          {[
            {
              q: 'Is my email content ever stored?',
              a: 'Never. We only read metadata — like email size and date. We never access or store the content of your messages.',
            },
            {
              q: 'What happens when I "clean" emails?',
              a: 'Emails are moved to your Gmail Trash — never permanently deleted. You can restore them any time within 30 days. Gmail empties Trash automatically after 30 days.',
            },
            {
              q: 'Can I switch plans later?',
              a: 'Yes. You can cancel your current plan at any time from the dashboard and subscribe to a different billing period at next renewal.',
            },
            {
              q: 'What happens when my plan ends?',
              a: 'You automatically revert to the Free tier — 500 lifetime credits plus 50 per day. Your history, scan results, and data are preserved.',
            },
            {
              q: 'What Gmail permissions are used?',
              a: 'We request gmail.readonly (to scan) and gmail.modify (to move emails to Trash). We never request gmail.send or access to compose.',
            },
          ].map((faq, i) => (
            <div key={i} className="border-b border-gray-100 py-5">
              <p className="font-semibold text-gray-900 mb-1.5">{faq.q}</p>
              <p className="text-gray-500 text-sm leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
