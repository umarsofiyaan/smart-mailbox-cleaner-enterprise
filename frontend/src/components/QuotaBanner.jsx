// src/components/QuotaBanner.jsx
// Displays free-tier quota usage (for non-Pro users).
// Shows lifetime + daily remaining, with upgrade link if exhausted.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cleanupApi } from '../api/client';

export default function QuotaBanner({ isPro }) {
  const navigate = useNavigate();
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadQuota();
  }, []);

  async function loadQuota() {
    try {
      const response = await cleanupApi.getQuota();
      setQuota(response.data.quota);
    } catch (err) {
      console.error('Failed to load quota', err);
    } finally {
      setLoading(false);
    }
  }

  if (isPro || loading || !quota) return null;

  const isExhausted = !quota.lifetime.remaining && !quota.daily.remaining;

  // Quota breakdown
  const lifetimePercent = Math.min(100, (quota.lifetime.used / quota.lifetime.allowance) * 100);
  const dailyPercent = Math.min(100, (quota.daily.used / quota.daily.allowance) * 100);

  return (
    <div className={`rounded-lg border p-4 mb-6 ${
      isExhausted
        ? 'bg-red-50 border-red-200'
        : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className={`font-semibold text-sm ${
            isExhausted ? 'text-red-900' : 'text-amber-900'
          }`}>
            {isExhausted ? '📭 Free quota exhausted' : '📬 Free Tier Usage'}
          </h3>
          <p className={`text-xs mt-1 ${
            isExhausted ? 'text-red-700' : 'text-amber-700'
          }`}>
            {quota.message}
          </p>
        </div>
        {isExhausted && (
          <button
            onClick={() => navigate('/pricing')}
            className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors whitespace-nowrap"
          >
            Upgrade to Pro
          </button>
        )}
      </div>

      {/* Quota bars */}
      <div className="space-y-2">
        {/* Lifetime bar */}
        {quota.lifetime.remaining !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className={isExhausted ? 'text-red-600' : 'text-amber-600'}>
                Lifetime: {quota.lifetime.used}/{quota.lifetime.allowance}
              </span>
              <span className={isExhausted ? 'text-red-600' : 'text-amber-600'}>
                {quota.lifetime.remaining} remaining
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isExhausted ? 'bg-red-400' : 'bg-amber-400'
                }`}
                style={{ width: `${lifetimePercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Daily bar (only show if lifetime exhausted) */}
        {quota.lifetime.remaining === 0 && quota.daily.remaining !== null && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className={isExhausted ? 'text-red-600' : 'text-amber-600'}>
                Today: {quota.daily.used}/{quota.daily.allowance}
              </span>
              <span className={isExhausted ? 'text-red-600' : 'text-amber-600'}>
                {quota.daily.remaining} remaining (resets at midnight UTC)
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  isExhausted ? 'bg-red-400' : 'bg-amber-400'
                }`}
                style={{ width: `${dailyPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
