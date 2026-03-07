import { useState } from 'react';

function formatUsd(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default function PaywallModal({
  isOpen,
  onClose,
  onUnlock,
  pricing,
  requestedCount,
  preview,
  loadingPlan,
}) {
  const [selectedPlan, setSelectedPlan] = useState('pro');

  if (!isOpen) return null;

  const plans = [
    pricing?.plans?.starter,
    pricing?.plans?.pro,
    pricing?.plans?.power,
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 p-4 flex items-center justify-center">
      <div className="w-full max-w-3xl bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-slate-50 to-blue-50">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-widest">Your cleanup is ready</p>
          <h2 className="text-2xl font-bold text-gray-900 mt-1">
            {requestedCount?.toLocaleString?.() || requestedCount} emails will be permanently removed.
          </h2>
          <p className="text-sm text-gray-600 mt-2">Unlock cleanup to finish.</p>

          {preview && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <p className="text-gray-500">Inbox size</p>
                <p className="font-semibold text-gray-900">{preview.before} -&gt; {preview.after}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <p className="text-gray-500">Emails removed</p>
                <p className="font-semibold text-gray-900">{requestedCount?.toLocaleString?.() || requestedCount}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3">
                <p className="text-gray-500">Estimated time saved</p>
                <p className="font-semibold text-gray-900">{preview.timeSaved}</p>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.planType;
            return (
              <button
                key={plan.planType}
                onClick={() => setSelectedPlan(plan.planType)}
                className={`text-left border rounded-xl p-4 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{plan.label}</p>
                  {plan.planType === 'pro' && (
                    <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      Most Popular
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">{plan.limitLabel}</p>
                <p className="text-2xl font-bold text-gray-900 mt-3">{formatUsd(plan.priceUsd)}</p>
              </button>
            );
          })}
        </div>

        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            Not now
          </button>
          <button
            onClick={() => onUnlock(selectedPlan)}
            disabled={!!loadingPlan}
            className="px-5 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
          >
            {loadingPlan ? 'Unlocking...' : 'Unlock Cleanup'}
          </button>
        </div>
      </div>
    </div>
  );
}
