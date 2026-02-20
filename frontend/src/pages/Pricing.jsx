// src/pages/Pricing.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscriptionApi } from '../api/client';
import { useAuth } from '../hooks/useAuth.jsx';

const FREE_FEATURES = [
  'Scan last 12 months of emails',
  'View space-saving suggestions',
  'See confidence scores',
  'Storage usage dashboard',
];

const PRO_FEATURES = [
  'Everything in Free',
  'Full mailbox scan (all years)',
  'Bulk cleanup — 1 click',
  'Undo any cleanup for 30 days',
  'Auto weekly cleanup',
  'Duplicate email detection',
  'Priority support',
];

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(true);
    try {
      const response = await subscriptionApi.createCheckout();
      window.location.href = response.data.url;
    } catch {
      alert('Failed to start checkout. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Simple, honest pricing</h1>
          <p className="text-gray-500 text-lg">Start free. Upgrade when you're ready to clean.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {/* Free */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <div className="mb-6">
              <p className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-1">Free</p>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">$0</span>
                <span className="text-gray-400">/month</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {FREE_FEATURES.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="text-gray-400">✓</span> {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => navigate(user ? '/dashboard' : '/login')}
              className="w-full py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
            >
              {user ? 'Go to Dashboard' : 'Get Started Free'}
            </button>
          </div>

          {/* Pro */}
          <div className="bg-brand-600 rounded-2xl shadow-xl p-8 relative overflow-hidden">
            <div className="absolute top-4 right-4 bg-yellow-400 text-yellow-900 text-xs font-bold px-3 py-1 rounded-full">
              Most Popular
            </div>

            <div className="mb-6">
              <p className="text-sm font-semibold text-brand-200 uppercase tracking-wide mb-1">Pro</p>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-white">$5</span>
                <span className="text-brand-300">/month</span>
              </div>
            </div>

            <ul className="space-y-3 mb-8">
              {PRO_FEATURES.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-white">
                  <span className="text-brand-300">✓</span> {f}
                </li>
              ))}
            </ul>

            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="w-full py-3 rounded-xl bg-white text-brand-700 font-bold hover:bg-brand-50 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
              ) : (
                user?.subscription?.isPro ? 'Manage Subscription' : 'Upgrade to Pro'
              )}
            </button>

            <p className="text-xs text-brand-300 text-center mt-3">
              Cancel anytime. 100% refund within 7 days.
            </p>
          </div>
        </div>

        {/* FAQ */}
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
              q: 'Can I undo a cleanup?',
              a: 'Yes. Every cleanup action can be undone for 30 days. Just click "Undo" in the dashboard.',
            },
            {
              q: 'What Gmail scopes are requested?',
              a: 'We request gmail.readonly (to scan) and gmail.modify (to move emails to Trash). We never request gmail.send or access to compose.',
            },
          ].map((faq, i) => (
            <div key={i} className="border-b border-gray-100 py-5">
              <p className="font-semibold text-gray-900 mb-1">{faq.q}</p>
              <p className="text-gray-500 text-sm">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
