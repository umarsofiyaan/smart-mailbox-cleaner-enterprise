// src/components/QuotaBanner.jsx
// Free-tier quota display for non-Pro users.
// Round 3: 80% warning state — shows upgrade nudge before hitting the wall.
// `refreshKey` prop incremented by Dashboard after each cleanup to force re-fetch.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cleanupApi } from '../api/client';

export default function QuotaBanner({ isPro, refreshKey = 0 }) {
  const navigate = useNavigate();
  const [quota,   setQuota]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isPro) return;
    (async () => {
      try {
        setLoading(true);
        const res = await cleanupApi.getQuota();
        setQuota(res.data.quota);
      } catch (err) {
        console.error('Failed to load quota', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [isPro, refreshKey]);

  if (isPro || loading || !quota) return null;

  const lifetimeUsed      = quota.lifetime?.used      ?? 0;
  const lifetimeAllowance = quota.lifetime?.allowance  ?? 500;
  const lifetimeRemaining = quota.lifetime?.remaining  ?? lifetimeAllowance;
  const lifetimePct       = Math.min(100, (lifetimeUsed / lifetimeAllowance) * 100);

  const dailyUsed         = quota.daily?.used      ?? 0;
  const dailyAllowance    = quota.daily?.allowance  ?? 50;
  const dailyRemaining    = quota.daily?.remaining  ?? 0;
  const dailyPct          = dailyAllowance ? Math.min(100, (dailyUsed / dailyAllowance) * 100) : 0;

  const isExhausted = lifetimeRemaining === 0 && dailyRemaining === 0;
  const isWarning   = !isExhausted && lifetimePct >= 80;   // 80–99%

  const theme = isExhausted
    ? { bg: 'bg-red-50',    border: 'border-red-200',    title: 'text-red-900',    sub: 'text-red-700',    bar: 'bg-red-400',    btnBg: 'bg-red-600 hover:bg-red-700',       badge: 'bg-red-100 text-red-700' }
    : isWarning
    ? { bg: 'bg-orange-50', border: 'border-orange-200', title: 'text-orange-900', sub: 'text-orange-700', bar: 'bg-orange-400', btnBg: 'bg-orange-500 hover:bg-orange-600', badge: 'bg-orange-100 text-orange-700' }
    : { bg: 'bg-amber-50',  border: 'border-amber-200',  title: 'text-amber-900',  sub: 'text-amber-700',  bar: 'bg-amber-400',  btnBg: null,                                badge: null };

  const icon = isExhausted ? '📭' : isWarning ? '⚠️' : '📬';

  const titleText = isExhausted
    ? 'Free quota exhausted'
    : isWarning
    ? `${Math.round(lifetimePct)}% of free credits used`
    : 'Free Tier Usage';

  return (
    <div className={`rounded-xl border p-4 mb-6 ${theme.bg} ${theme.border}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className={`font-semibold text-sm ${theme.title}`}>
              {icon} {titleText}
            </h3>
            {isWarning && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${theme.badge}`}>
                Running low
              </span>
            )}
          </div>

          {/* Contextual sub-message */}
          {isExhausted && (
            <p className={`text-xs ${theme.sub}`}>
              Lifetime credits used up. You get <strong>50 free credits/day</strong> now — or upgrade for unlimited.
            </p>
          )}
          {isWarning && (
            <p className={`text-xs ${theme.sub}`}>
              <strong>{lifetimeRemaining} credits left</strong>. After that you get 50/day, or{' '}
              <button
                onClick={() => navigate('/pricing')}
                className="underline font-semibold hover:opacity-80"
              >
                upgrade to Pro for unlimited →
              </button>
            </p>
          )}
          {!isExhausted && !isWarning && (
            <p className={`text-xs ${theme.sub}`}>{quota.message}</p>
          )}
        </div>

        {/* CTA button */}
        {theme.btnBg && (
          <button
            onClick={() => navigate('/pricing')}
            className={`flex-shrink-0 px-3 py-1.5 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${theme.btnBg}`}
          >
            {isExhausted ? 'Upgrade to Pro' : 'See Pro Plans'}
          </button>
        )}
      </div>

      {/* Progress bars */}
      <div className="space-y-2">
        {/* Lifetime bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className={theme.sub}>Lifetime: {lifetimeUsed}/{lifetimeAllowance}</span>
            <span className={theme.sub}>{lifetimeRemaining} remaining</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${theme.bar}`}
              style={{ width: `${lifetimePct}%` }}
            />
          </div>
        </div>

        {/* Daily bar — shown only after lifetime is exhausted */}
        {lifetimeRemaining === 0 && (
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className={theme.sub}>Today: {dailyUsed}/{dailyAllowance}</span>
              <span className={theme.sub}>{dailyRemaining} remaining (resets midnight UTC)</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${theme.bar}`}
                style={{ width: `${dailyPct}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
