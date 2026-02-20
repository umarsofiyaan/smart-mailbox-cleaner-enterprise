// src/components/StorageGauge.jsx
import { clsx } from 'clsx';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 GB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
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

export default function StorageGauge({ storage }) {
  if (!storage) return null;

  const {
    usedBytes = 0,
    quotaBytes = 0,
    percentUsed = 0,
    dailyGrowthBytes = 0,
    estimatedDaysUntilFull,
  } = storage;

  const barColor = getGaugeColor(percentUsed);
  const labelColor = getGaugeLabelColor(percentUsed);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Gmail Storage</h2>
        <span className={clsx('text-2xl font-bold', labelColor)}>
          {percentUsed}%
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
          <p className="text-base font-semibold text-gray-900">
            {dailyGrowthBytes > 0 ? `+${formatBytes(dailyGrowthBytes)}/day` : 'Calculating...'}
          </p>
        </div>
        <div className="bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 mb-1 font-medium uppercase tracking-wide">Est. days until full</p>
          <p className={clsx('text-base font-semibold', estimatedDaysUntilFull && estimatedDaysUntilFull < 90 ? 'text-orange-500' : 'text-gray-900')}>
            {estimatedDaysUntilFull
              ? `~${estimatedDaysUntilFull} days`
              : dailyGrowthBytes === 0
              ? 'Not growing'
              : 'Run 2+ scans'}
          </p>
        </div>
      </div>

      {percentUsed >= 90 && (
        <div className="mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700 font-medium">
            ⚠️ Your mailbox is almost full. Clean up now to continue receiving emails.
          </p>
        </div>
      )}
    </div>
  );
}
