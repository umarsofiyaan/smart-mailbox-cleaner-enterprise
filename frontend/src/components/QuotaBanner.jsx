// src/components/QuotaBanner.jsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cleanupApi } from '../api/client';

export default function QuotaBanner({ isPro, refreshKey = 0 }) {
  const navigate = useNavigate();
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await cleanupApi.getQuota();
        setQuota(res.data?.quota || res.data || null);
      } catch {
        setQuota(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [isPro, refreshKey]);

  if (loading || !quota) return null;

  const credits = Number(quota.deleteCredits ?? quota.delete_credits ?? 0);
  const planType = quota.planType || quota.plan_type || 'free';
  const powerActive = Boolean(quota.isPowerActive ?? quota.is_power_active);
  const emailsDeletedTotal = Number(quota.emailsDeletedTotal ?? quota.emails_deleted_total ?? 0);

  if (powerActive) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 mb-6">
        <p className="text-sm font-semibold text-emerald-900">Unlimited cleanup active</p>
        <p className="text-xs text-emerald-700 mt-1">Power plan is active until {new Date(quota.planExpiry || quota.plan_expiry).toLocaleString()}.</p>
      </div>
    );
  }

  const exhausted = credits <= 0;

  return (
    <div className={`rounded-xl border p-4 mb-6 ${exhausted ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-sm font-semibold ${exhausted ? 'text-red-900' : 'text-amber-900'}`}>
            {exhausted ? 'Credits exhausted' : `${credits.toLocaleString()} delete credits remaining`}
          </p>
          <p className={`text-xs mt-1 ${exhausted ? 'text-red-700' : 'text-amber-700'}`}>
            Plan: {planType}. Emails deleted total: {emailsDeletedTotal.toLocaleString()}.
          </p>
        </div>
        <button
          onClick={() => navigate('/pricing')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg text-white ${exhausted ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
        >
          See Plans
        </button>
      </div>
    </div>
  );
}
