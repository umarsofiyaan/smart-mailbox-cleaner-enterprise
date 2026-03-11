// src/components/StorageGauge.jsx
// Displays Gmail storage usage, daily growth rate, and estimated days until full.
//
// Data priority:
//  1. liveStorage  — from GET /user/storage-growth (live Google API + history)
//  2. storage      — from scan record (stale, only has growth if 2+ scans run)
//
// The liveStorage endpoint computes growth instantly by comparing the current
// live reading against historical scan data, so it works after just 1 past scan.

import { clsx } from 'clsx';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 GB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function formatDays(days) {
  if (!days || days <= 0) return null;
  if (days >= 9999) return '10+ years';
  if (days >= 365) return `~${(days / 365).toFixed(1)} years`;
  if (days >= 60)  return `~${Math.round(days / 30)} months`;
  return `~${days} days`;
}

function getGaugeColor(percent) {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-orange-400';
  if (percent >= 50) return 'bg-yellow-400';
  return 'bg-brand-500';
}

function getGaugeLabelColor(percent) {
  if (percent >= 90) return 'text-red-600';
  if (percent >= 70) return 'text-orange-500';
  return 'text-brand-600';
}

function Spinner() {
  return (
    <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
  );
}

export default function StorageGauge({ storage, liveStorage, liveStorageLoading }) {
  // Prefer live data when available — it's fresher and computes growth better
  const data = liveStorage || storage;
  if (!data) return null;

  const usedBytes          = data.usedBytes          ?? data.storageUsedBytes  ?? 0;
  const quotaBytes         = data.quotaBytes          ?? data.storageQuotaBytes ?? 0;
  const percentUsed        = data.percentUsed         ?? (quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0);
  const dailyGrowthBytes   = data.dailyGrowthBytes    ?? 0;
  const estimatedDaysUntilFull = data.estimatedDaysUntilFull ?? null;
  const dataPointCount     = data.dataPointCount      ?? null;   // only present on liveStorage

  const barColor   = getGaugeColor(percentUsed);
  const labelColor = getGaugeLabelColor(percentUsed);

  // ── Growth cell logic ──────────────────────────────────────────────────────
  // States:
  //  loading       → spinner (live fetch in flight)
  //  dailyGrowth>0 → show +X/day
  //  growth=0 & have data → "Not growing"
  //  no history (first login, dataPointCount===1) → "Measuring…" (need 1 more scan or next login)
  //  otherwise     → "Calculating…"

  const hasLiveData = !!liveStorage;

  let growthDisplay;
  let growthSub = null;

  if (liveStorageLoading) {
    growthDisplay = <Spinner />;
  } else if (hasLiveData) {
    if (dailyGrowthBytes > 0) {
      growthDisplay = `+${formatBytes(dailyGrowthBytes)}/day`;
    } else if (dataPointCount === 1) {
      // Only one data point — we have the current live reading but no history yet.
      // Next login (or next scan) will give us 2 points and show real growth.
      growthDisplay = 'Measuring…';
      growthSub = 'Will show after next login';
    } else {
      growthDisplay = 'Not growing 📉';
    }
  } else {
    // Falling back to scan.storage (liveStorage unavailable / Drive API failed)
    if (dailyGrowthBytes > 0) {
      growthDisplay = `+${formatBytes(dailyGrowthBytes)}/day`;
    } else {
      // No growth data in scan record — need a 2nd scan to compute rate
      growthDisplay = 'Run another scan';
      growthSub = 'to measure growth rate';
    }
  }

  // ── Days until full logic ──────────────────────────────────────────────────
  let daysDisplay;
  let daysUrgent = false;

  if (liveStorageLoading) {
    daysDisplay = <Spinner />;
  } else if (estimatedDaysUntilFull) {
    daysDisplay = formatDays(estimatedDaysUntilFull);
    daysUrgent  = estimatedDaysUntilFull < 90;
  } else if (dailyGrowthBytes > 0) {
    daysDisplay = 'Calculating…';
  } else if (hasLiveData && dataPointCount === 1) {
    daysDisplay = 'Need more data';
  } else if (hasLiveData) {
    daysDisplay = 'Not filling up ✓';
  } else {
    // No live data, no growth history — need another scan
    daysDisplay = 'Need another scan';
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
          <p className={clsx(
            'text-base font-semibold',
            dailyGrowthBytes > 0 ? 'text-orange-500' : 'text-gray-900'
          )}>
            {growthDisplay}
          </p>
          {growthSub && (
            <p className="text-xs text-gray-400 mt-0.5">{growthSub}</p>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Est. days until full</p>
          <p className={clsx(
            'text-base font-semibold',
            daysUrgent ? 'text-orange-500' : 'text-gray-900'
          )}>
            {daysDisplay}
          </p>
        </div>
      </div>

      {/* Data source indicator */}
      {hasLiveData && !liveStorageLoading && (
        <p className="text-xs text-gray-400 mt-3 flex items-center gap-1">
          {liveStorage?.source === 'scan_fallback' ? (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400" />
              From last scan · run a new scan to refresh
            </>
          ) : (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
              Live data · updated just now
              {dataPointCount !== null && ` · ${dataPointCount} data point${dataPointCount !== 1 ? 's' : ''}`}
            </>
          )}
        </p>
      )}

      {/* Warning for almost-full mailbox */}
      {percentUsed >= 90 && (
        <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700 font-medium">
            ⚠️ Your mailbox is almost full. Clean up now to continue receiving emails.
          </p>
        </div>
      )}

      {/* Warning for fast-filling mailbox */}
      {!liveStorageLoading && daysUrgent && percentUsed < 90 && (
        <div className="mt-4 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3">
          <p className="text-sm text-orange-700 font-medium">
            📈 At this rate your mailbox fills in {formatDays(estimatedDaysUntilFull)}. Consider a cleanup.
          </p>
        </div>
      )}
    </div>
  );
}
