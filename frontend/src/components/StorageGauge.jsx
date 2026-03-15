// src/components/StorageGauge.jsx
// Displays Gmail storage usage, daily growth rate, and estimated days until full.
//
// Data sources (in priority order):
//  1. liveStorage.source === 'live'          → real-time from Google Drive API
//  2. liveStorage.source === 'scan_fallback' → computed from scan history
//  3. storage (scan record)                  → last resort if liveStorage never arrives
//
// Key flags from backend:
//  needsDriveReauth  → Drive scope not granted; show reconnect prompt
//  scansTooRecent    → all scans done same day; can't compute growth yet

import { clsx } from 'clsx';

const BACKEND_URL = import.meta.env.VITE_API_URL || '';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 GB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function formatDays(days) {
  if (!days || days <= 0) return null;
  if (days >= 9999) return '10+ years';
  if (days >= 365)  return `~${(days / 365).toFixed(1)} yrs`;
  if (days >= 60)   return `~${Math.round(days / 30)} months`;
  return `~${days} days`;
}

function getGaugeColor(pct) {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-orange-400';
  if (pct >= 50) return 'bg-yellow-400';
  return 'bg-brand-500';
}

function getGaugeLabelColor(pct) {
  if (pct >= 90) return 'text-red-600';
  if (pct >= 70) return 'text-orange-500';
  return 'text-brand-600';
}

function Spinner() {
  return <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />;
}

export default function StorageGauge({ storage, liveStorage, liveStorageLoading }) {
  const data = liveStorage || storage;
  if (!data) return null;

  const usedBytes          = data.usedBytes          ?? data.storageUsedBytes  ?? 0;
  const quotaBytes         = data.quotaBytes          ?? data.storageQuotaBytes ?? 0;
  const percentUsed        = data.percentUsed         ?? (quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0);
  const dailyGrowthBytes   = data.dailyGrowthBytes    ?? 0;
  const estimatedDays      = data.estimatedDaysUntilFull ?? null;
  const dataPointCount     = data.dataPointCount      ?? null;
  const isScanFallback     = data.source === 'scan_fallback';
  const isLive             = data.source === 'live';
  const needsDriveReauth   = !!data.needsDriveReauth;
  const scansTooRecent     = !!data.scansTooRecent;
  const hasData            = !!liveStorage;

  const barColor   = getGaugeColor(percentUsed);
  const labelColor = getGaugeLabelColor(percentUsed);

  // ── Growth display ────────────────────────────────────────────────────────
  let growthDisplay;
  let growthSub = null;
  let growthColor = 'text-gray-900';

  if (liveStorageLoading) {
    growthDisplay = <Spinner />;

  } else if (dailyGrowthBytes > 0) {
    // Real growth detected — show the number
    growthDisplay = `+${formatBytes(dailyGrowthBytes)}/day`;
    growthColor   = 'text-orange-500';
    if (isScanFallback) growthSub = 'based on scan history';

  } else if (hasData && scansTooRecent) {
    // Scans all happened today — not enough time between readings to compute rate
    growthDisplay = 'Check back tomorrow';
    growthSub     = `${dataPointCount} scan${dataPointCount !== 1 ? 's' : ''}, all from today`;

  } else if (hasData && dataPointCount >= 2) {
    // Multiple scans over different days, no net growth = stable mailbox
    growthDisplay = 'Stable';
    growthSub     = `no net change across ${dataPointCount} scans`;

  } else if (hasData && dataPointCount === 1) {
    growthDisplay = 'Run one more scan';
    growthSub     = 'to calculate growth rate';

  } else {
    // Pure scan.storage fallback — no live data available
    growthDisplay = dailyGrowthBytes > 0
      ? `+${formatBytes(dailyGrowthBytes)}/day`
      : '—';
  }

  // ── Days until full ───────────────────────────────────────────────────────
  let daysDisplay;
  let daysUrgent = false;

  if (liveStorageLoading) {
    daysDisplay = <Spinner />;

  } else if (estimatedDays && estimatedDays > 0) {
    daysDisplay = formatDays(estimatedDays);
    daysUrgent  = estimatedDays < 90;

  } else if (dailyGrowthBytes > 0) {
    // Has growth but no estimatedDays — compute it now
    const remaining = quotaBytes - usedBytes;
    const computed  = remaining > 0 ? Math.floor(remaining / dailyGrowthBytes) : null;
    daysDisplay = computed ? formatDays(computed) : 'Calculating…';
    daysUrgent  = computed && computed < 90;

  } else if (hasData && scansTooRecent) {
    daysDisplay = 'Check back tomorrow';

  } else if (hasData && dataPointCount >= 2) {
    daysDisplay = 'Not filling up ✓';

  } else if (hasData && dataPointCount === 1) {
    daysDisplay = 'Run one more scan';

  } else {
    daysDisplay = '—';
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Gmail Storage</h2>
        <span className={clsx('text-2xl font-bold', labelColor)}>
          {liveStorageLoading && !data.percentUsed ? <Spinner /> : `${percentUsed}%`}
        </span>
      </div>

      {/* Gauge bar */}
      <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden mb-3">
        <div
          className={clsx('h-4 rounded-full transition-all duration-700 ease-out', barColor)}
          style={{ width: `${Math.min(percentUsed, 100)}%` }}
        />
      </div>

      <div className="flex justify-between text-sm text-gray-500 mb-5">
        <span>{formatBytes(usedBytes)} used</span>
        <span>{formatBytes(quotaBytes)} total</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Daily growth</p>
          <p className={clsx('text-base font-semibold', growthColor)}>
            {growthDisplay}
          </p>
          {growthSub && <p className="text-xs text-gray-400 mt-0.5">{growthSub}</p>}
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Est. days until full</p>
          <p className={clsx('text-base font-semibold', daysUrgent ? 'text-orange-500' : 'text-gray-900')}>
            {daysDisplay}
          </p>
        </div>
      </div>

      {/* ── Drive reauth banner ── */}
      {needsDriveReauth && !liveStorageLoading && (
        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-lg mt-0.5 flex-shrink-0">🔑</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-800 font-semibold">Reconnect Google for live storage</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-snug">
              Live storage data needs a Google Drive permission that wasn't granted when you first signed in.
              One click to re-connect — your emails and settings are unaffected.
            </p>
          </div>
          <a
            href={`${BACKEND_URL}/auth/google?force=true&scope=storage`}
            className="flex-shrink-0 mt-0.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Reconnect
          </a>
        </div>
      )}

      {/* ── Same-day scans notice ── */}
      {!needsDriveReauth && hasData && scansTooRecent && !liveStorageLoading && (
        <div className="mt-4 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-xs text-blue-700 leading-snug">
            📊 Growth rate requires scans on different days. Run another scan tomorrow to see your daily usage trend.
          </p>
        </div>
      )}

      {/* Data source indicator */}
      {hasData && !liveStorageLoading && !needsDriveReauth && (
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-1.5">
          {isScanFallback ? (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
              From {dataPointCount} scan{dataPointCount !== 1 ? 's' : ''} · live storage unavailable
            </>
          ) : (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
              Live data · updated just now
              {dataPointCount !== null && ` · ${dataPointCount} data point${dataPointCount !== 1 ? 's' : ''}`}
            </>
          )}
        </p>
      )}

      {/* Warning: almost full */}
      {percentUsed >= 90 && (
        <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700 font-medium">
            ⚠️ Your mailbox is almost full. Clean up now to continue receiving emails.
          </p>
        </div>
      )}

      {/* Warning: filling up fast */}
      {!liveStorageLoading && daysUrgent && percentUsed < 90 && (
        <div className="mt-4 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
          <p className="text-sm text-orange-700 font-medium">
            📈 At this rate your mailbox fills in {formatDays(estimatedDays)}. Consider a cleanup.
          </p>
        </div>
      )}
    </div>
  );
}
