// src/components/StorageGauge.jsx
// Displays Gmail storage usage, daily growth rate, and estimated days until full.
//
// Data priority:
//  1. liveStorage  — from GET /user/storage-growth
//       source === undefined   → live Google Drive API reading
//       source === 'scan_fallback' → computed from scan history (Drive API unavailable)
//  2. storage      — from scan record (stale, used only if liveStorage never loads)

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
  if (days >= 365)  return `~${(days / 365).toFixed(1)} years`;
  if (days >= 60)   return `~${Math.round(days / 30)} months`;
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
  return <span className="inline-block w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />;
}

export default function StorageGauge({ storage, liveStorage, liveStorageLoading }) {
  // Prefer live/fallback data; fall back to scan.storage as last resort
  const data = liveStorage || storage;
  if (!data) return null;

  const usedBytes          = data.usedBytes          ?? data.storageUsedBytes  ?? 0;
  const quotaBytes         = data.quotaBytes          ?? data.storageQuotaBytes ?? 0;
  const percentUsed        = data.percentUsed         ?? (quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : 0);
  const dailyGrowthBytes   = data.dailyGrowthBytes    ?? 0;
  const estimatedDaysUntilFull = data.estimatedDaysUntilFull ?? null;
  const dataPointCount     = data.dataPointCount      ?? null;
  const isScanFallback     = data.source === 'scan_fallback';
  const hasData            = !!liveStorage;  // true for both live and scan_fallback

  const barColor   = getGaugeColor(percentUsed);
  const labelColor = getGaugeLabelColor(percentUsed);

  // ── Growth display ────────────────────────────────────────────────────────
  // Priority:
  //  1. Loading → spinner
  //  2. dailyGrowthBytes > 0 → "+X MB/day"
  //  3. hasData + dataPointCount >= 2 + growth=0 → "Not growing 📉" (stable mailbox)
  //  4. hasData + dataPointCount === 1 → "Need one more scan" (only 1 data point)
  //  5. No data at all → use scan.storage values
  let growthDisplay;
  let growthSub = null;

  if (liveStorageLoading) {
    growthDisplay = <Spinner />;
  } else if (dailyGrowthBytes > 0) {
    // Growth detected — show rate regardless of data source
    growthDisplay = `+${formatBytes(dailyGrowthBytes)}/day`;
    growthSub = isScanFallback ? 'based on scan history' : null;
  } else if (hasData && dataPointCount >= 2) {
    // Multiple scans, no net growth → mailbox is stable (user cleaned up or inbox is steady)
    growthDisplay = 'Stable 📉';
    growthSub = isScanFallback
      ? `across ${dataPointCount} scans`
      : 'no net growth detected';
  } else if (hasData && dataPointCount === 1) {
    // Only 1 data point — run one more scan to get a comparison
    growthDisplay = 'Need one more scan';
    growthSub = 'to measure growth rate';
  } else {
    // Absolute fallback — scan.storage data with no growth recorded
    growthDisplay = dailyGrowthBytes > 0
      ? `+${formatBytes(dailyGrowthBytes)}/day`
      : 'Stable 📉';
  }

  // ── Days until full ───────────────────────────────────────────────────────
  let daysDisplay;
  let daysUrgent = false;

  if (liveStorageLoading) {
    daysDisplay = <Spinner />;
  } else if (estimatedDaysUntilFull) {
    daysDisplay = formatDays(estimatedDaysUntilFull);
    daysUrgent  = estimatedDaysUntilFull < 90;
  } else if (dailyGrowthBytes > 0) {
    // Has growth rate but no days estimate (shouldn't normally happen)
    daysDisplay = 'Calculating…';
  } else if (hasData && dataPointCount >= 2) {
    // Stable — not filling up
    daysDisplay = 'Not filling up ✓';
  } else if (hasData && dataPointCount === 1) {
    daysDisplay = 'Need one more scan';
  } else {
    daysDisplay = estimatedDaysUntilFull ? formatDays(estimatedDaysUntilFull) : 'Not filling up ✓';
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
          {growthSub && <p className="text-xs text-gray-400 mt-0.5">{growthSub}</p>}
        </div>

        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Est. days until full</p>
          <p className={clsx('text-base font-semibold', daysUrgent ? 'text-orange-500' : 'text-gray-900')}>
            {daysDisplay}
          </p>
        </div>
      </div>

      {/* Data source indicator */}
      {hasData && !liveStorageLoading && (
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
            📈 At this rate your mailbox fills in {formatDays(estimatedDaysUntilFull)}. Consider a cleanup.
          </p>
        </div>
      )}
    </div>
  );
}
