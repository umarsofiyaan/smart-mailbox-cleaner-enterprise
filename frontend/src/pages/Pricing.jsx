import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscriptionApi } from '../api/client';
import { useAuth } from '../hooks/useAuth.jsx';

function fmt(price) {
  return `$${Number(price || 0).toFixed(2)}`;
}

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await subscriptionApi.getPricing();
        setPricing(res.data || null);
      } catch {
        setPricing(null);
      }
    })();
  }, []);

  async function handleBuy(planType) {
    if (!user) {
      navigate('/login');
      return;
    }

    setLoading(planType);
    setError('');
    try {
      await subscriptionApi.purchase(planType);
      navigate('/dashboard?upgrade=success');
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Purchase failed.');
    } finally {
      setLoading('');
    }
  }

  const plans = [pricing?.plans?.starter, pricing?.plans?.pro, pricing?.plans?.power].filter(Boolean);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <nav className="border-b border-gray-100 bg-white px-6 py-4 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate(user ? '/dashboard' : '/')} className="text-sm text-gray-600 hover:text-gray-900">Back</button>
          <div className="flex items-center gap-2">
            <img src="/icon-72.png" alt="" className="w-7 h-7 rounded-lg" />
            <span className="font-bold text-gray-900 text-sm">Smart Mailbox Cleaner</span>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-14">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-gray-900 mb-3">Unlock Cleanup</h1>
          <p className="text-gray-500 text-lg">Choose a plan to finish deleting emails.</p>
          {pricing?.countryCode && (
            <p className="text-xs text-gray-400 mt-2">Regional pricing detected for {pricing.countryCode} ({pricing.region}).</p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-8 text-center">
            <p className="text-red-700 text-sm font-medium">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <div key={plan.planType} className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
              <p className="text-sm font-bold text-gray-900">{plan.label}</p>
              <p className="text-xs text-gray-500 mt-1">{plan.limitLabel}</p>
              <p className="text-4xl font-extrabold text-gray-900 mt-5">{fmt(plan.priceUsd)}</p>
              <button
                onClick={() => handleBuy(plan.planType)}
                disabled={loading === plan.planType}
                className="mt-6 w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
              >
                {loading === plan.planType ? 'Processing...' : 'Unlock Cleanup'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
