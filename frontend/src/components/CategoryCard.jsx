import { useEffect, useMemo, useState } from 'react';
import { clsx } from 'clsx';
import ConfidenceBadge from './ConfidenceBadge';

const COLOR_MAP = {
  red:    { bg: 'bg-red-50',    icon: 'bg-red-100 text-red-600',       border: 'border-red-100' },
  orange: { bg: 'bg-orange-50', icon: 'bg-orange-100 text-orange-600', border: 'border-orange-100' },
  purple: { bg: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600', border: 'border-purple-100' },
  blue:   { bg: 'bg-blue-50',   icon: 'bg-blue-100 text-blue-600',     border: 'border-blue-100' },
  gray:   { bg: 'bg-gray-50',   icon: 'bg-gray-200 text-gray-600',     border: 'border-gray-200' },
  green:  { bg: 'bg-green-50',  icon: 'bg-green-100 text-green-600',   border: 'border-green-100' },
  teal:   { bg: 'bg-teal-50',   icon: 'bg-teal-100 text-teal-600',     border: 'border-teal-100' },
  indigo: { bg: 'bg-indigo-50', icon: 'bg-indigo-100 text-indigo-600', border: 'border-indigo-100' },
};

const ICON_GLYPHS = {
  PaperclipIcon:   '📎',
  TagIcon:         '🏷️',
  UsersIcon:       '👥',
  ClockIcon:       '🕐',
  CalendarIcon:    '📅',
  CloudIcon:       '☁️',
  AdjustmentsIcon: '🎛️',
};

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function formatDate(internalDate) {
  if (!internalDate) return '';
  return new Date(Number(internalDate)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function truncate(str, n) {
  if (!str) return '(no subject)';
  return str.length > n ? str.slice(0, n) + '...' : str;
}

// ── Per-tier config ──────────────────────────────────────────────────────────

const TIER_CONFIG = {
  HIGH: {
    label:       'Safe to Delete',
    icon:        '✅',
    pillBg:      'bg-green-100',
    pillText:    'text-green-700',
    headerBg:    'bg-green-50',
    badgeCls:    'bg-green-100 text-green-700',
    description: 'Clearly safe to remove',
  },
  MEDIUM: {
    label:       'Likely Safe',
    icon:        '⚠️',
    pillBg:      'bg-yellow-100',
    pillText:    'text-yellow-700',
    headerBg:    'bg-yellow-50',
    badgeCls:    'bg-yellow-100 text-yellow-700',
    description: 'Probably safe — glance through first',
  },
  REVIEW_REQUIRED: {
    label:       'Needs Review',
    icon:        '🔍',
    pillBg:      'bg-orange-100',
    pillText:    'text-orange-700',
    headerBg:    'bg-orange-50',
    badgeCls:    'bg-orange-100 text-orange-700',
    description: 'Check before deleting',
  },
};

function ReviewEmailRow({ msg, checked, onToggle }) {
  const cfg = TIER_CONFIG[msg.tier] || TIER_CONFIG.REVIEW_REQUIRED;
  return (
    <label className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(msg.id)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 font-medium truncate leading-snug">
          {truncate(msg.subject, 80)}
        </p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {truncate(msg.from, 60)} &middot; {formatDate(msg.internalDate)}
        </p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badgeCls}`}>
          {cfg.icon} {cfg.label}
        </span>
        <span className="text-xs text-gray-400">{formatMB(msg.sizeEstimate)}</span>
      </div>
    </label>
  );
}

// ── 3-tier breakdown bar + legend ────────────────────────────────────────────

function TierBreakdown({ highCount, mediumCount, reviewCount, total, sampleSize }) {
  if (!total) return null;

  const tiers = [
    { key: 'HIGH',            count: highCount,   ...TIER_CONFIG.HIGH },
    { key: 'MEDIUM',          count: mediumCount, ...TIER_CONFIG.MEDIUM },
    { key: 'REVIEW_REQUIRED', count: reviewCount, ...TIER_CONFIG.REVIEW_REQUIRED },
  ].filter(t => t.count > 0);

  const isSampled = sampleSize && sampleSize < total;

  return (
    <div className="mb-4">
      {/* Stacked progress bar */}
      <div className="flex rounded-full overflow-hidden h-2 mb-3 bg-gray-100">
        {highCount > 0 && (
          <div
            className="bg-green-400 transition-all"
            style={{ width: `${(highCount / total) * 100}%` }}
            title={`Safe to Delete: ${highCount.toLocaleString()}`}
          />
        )}
        {mediumCount > 0 && (
          <div
            className="bg-yellow-400 transition-all"
            style={{ width: `${(mediumCount / total) * 100}%` }}
            title={`Likely Safe: ${mediumCount.toLocaleString()}`}
          />
        )}
        {reviewCount > 0 && (
          <div
            className="bg-orange-400 transition-all"
            style={{ width: `${(reviewCount / total) * 100}%` }}
            title={`Needs Review: ${reviewCount.toLocaleString()}`}
          />
        )}
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {tiers.map(tier => (
          <div key={tier.key} className="flex items-center justify-between">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${tier.pillBg} ${tier.pillText}`}>
              {tier.icon} {tier.label}
            </span>
            <span className="text-xs font-bold text-gray-700">
              ~{tier.count.toLocaleString()}
              {isSampled && <span className="font-normal text-gray-400"> est.</span>}
            </span>
          </div>
        ))}
      </div>

      {isSampled && (
        <p className="text-xs text-gray-400 mt-2.5 flex items-center gap-1">
          <span>ℹ️</span>
          <span>Tiers estimated from a {sampleSize.toLocaleString()}-email sample of {total.toLocaleString()} total.</span>
        </p>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function CategoryCard({
  category,
  onCleanup,
  isPro,
  isFreeWithQuota,
  quotaRemaining,
  isLoading,
  isLocked = false,
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const colors = COLOR_MAP[category.color] || COLOR_MAP.gray;

  // allMessages is the sampled preview (up to 2,000 emails).
  // category.messageCount is the TRUE total from Gmail.
  const allMessages   = category.messages || [];
  const allMessageIds = allMessages.map((m) => m.id);
  const [selectedIds, setSelectedIds] = useState(() => new Set(allMessageIds));

  useEffect(() => {
    setSelectedIds(new Set(allMessageIds));
  }, [category.key, category.messageCount]);

  if (category.messageCount === 0) return null;

  const selectedList  = allMessageIds.filter((id) => selectedIds.has(id));
  const selectedCount = selectedList.length;

  // canDeleteAllByQuery: backend will re-run the Gmail query and delete ALL
  // matching emails (not just the sampled preview). The real count is
  // category.messageCount, not selectedCount (sample size).
  const isQueryCleanup      = category.cleanup?.mode === 'query' && !!category.cleanup?.query;
  const canDeleteAllByQuery = isQueryCleanup && selectedCount === allMessageIds.length;

  const hasMessages = allMessageIds.length > 0;
  const isBusy      = isLoading || isLocked;

  const selectedBytes = useMemo(() => {
    if (selectedCount === allMessageIds.length) return category.totalBytes;
    return allMessages
      .filter((m) => selectedIds.has(m.id))
      .reduce((sum, m) => sum + Number(m.sizeEstimate || 0), 0);
  }, [allMessages, allMessageIds.length, category.totalBytes, selectedCount, selectedIds]);

  function toggleId(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() { setSelectedIds(new Set(allMessageIds)); }
  function clearAll()  { setSelectedIds(new Set()); }

  function triggerCleanup() {
    if (!selectedCount) return;

    // For query-based cleanup (deletes ALL by Gmail query, not just the sample),
    // the effective count is the full category.messageCount, not the sample's selectedCount.
    const effectiveTotalCount = canDeleteAllByQuery ? category.messageCount : selectedCount;

    const effectiveCount = !isPro && isFreeWithQuota && quotaRemaining > 0
      ? Math.min(effectiveTotalCount, quotaRemaining)
      : effectiveTotalCount;

    const selectedIdsCapped = (!isPro && isFreeWithQuota && quotaRemaining > 0)
      ? selectedList.slice(0, quotaRemaining)
      : selectedList;

    // Use query mode only when we aren't quota-limiting (to avoid partial deletes
    // that would leave the quota count inconsistent with actual deletion).
    const useQueryMode = canDeleteAllByQuery && effectiveCount === category.messageCount;

    onCleanup({
      category:       category.key,
      messageIds:     useQueryMode ? [] : selectedIdsCapped,
      estimatedBytes: selectedBytes,
      label:          category.label,
      messageCount:   effectiveCount,
      cleanupMode:    useQueryMode ? 'query' : 'ids',
      customQuery:    useQueryMode ? category.cleanup.query : null,
    });
  }

  // Display count on the button = full count for query mode, sample selection otherwise
  const buttonCount = canDeleteAllByQuery ? category.messageCount : selectedCount;

  const buttonLabel = (() => {
    if (isLocked)  return 'Cleanup already running...';
    if (isLoading) return 'Moving to Trash...';
    if (!isPro && isFreeWithQuota && quotaRemaining > 0 && buttonCount > quotaRemaining) {
      return `Move ${quotaRemaining.toLocaleString()} to Trash (quota limit)`;
    }
    return `Move to Trash (${buttonCount.toLocaleString()})`;
  })();

  return (
    <div className={clsx(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200',
      'border-gray-100 hover:shadow-md'
    )}>

      {/* ── Card header ── */}
      <div className={clsx('px-5 pt-5 pb-4', colors.bg)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center text-lg', colors.icon)}>
              {ICON_GLYPHS[category.icon] || '📧'}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{category.label}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{category.description}</p>
            </div>
          </div>
          <ConfidenceBadge tier={category.tier} compact />
        </div>
      </div>

      {/* ── Card body ── */}
      <div className="px-5 py-4">

        {/* Total counts */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-2xl font-bold text-gray-900">{category.messageCount.toLocaleString()}</p>
            <p className="text-xs text-gray-400">messages</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-brand-600">{formatMB(category.totalBytes)}</p>
            <p className="text-xs text-gray-400">to free up</p>
          </div>
        </div>

        {/* 3-tier breakdown */}
        <TierBreakdown
          highCount={category.highCount   || 0}
          mediumCount={category.mediumCount || 0}
          reviewCount={category.reviewCount || 0}
          total={category.messageCount}
          sampleSize={category.sampleSize}
        />

        {/* Preview toggle */}
        {hasMessages && (
          <>
            <button
              onClick={() => setReviewOpen((v) => !v)}
              className="w-full text-xs text-indigo-600 hover:text-indigo-700 font-medium text-left mb-3 flex items-center gap-1.5"
            >
              <span>{reviewOpen ? '▲' : '▼'}</span>
              {reviewOpen ? 'Hide preview' : `Preview sample`}
              {' '}({allMessageIds.length.toLocaleString()} of {category.messageCount.toLocaleString()})
            </button>

            {reviewOpen && (
              <div className="mb-4 border border-gray-100 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold text-gray-700">
                      Preview — uncheck emails to exclude from deletion
                    </p>
                    {category.sampleSize && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        Showing {allMessageIds.length.toLocaleString()} of {category.messageCount.toLocaleString()} (sampled for speed)
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={selectAll} className="text-indigo-600 hover:underline font-medium">Select all</button>
                    <button onClick={clearAll}  className="text-indigo-600 hover:underline font-medium">Clear</button>
                    <span className="text-gray-500">{selectedCount.toLocaleString()} selected</span>
                    <button onClick={() => setReviewOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none font-light">&times;</button>
                  </div>
                </div>

                {/* Grouped by tier */}
                {['HIGH', 'MEDIUM', 'REVIEW_REQUIRED'].map(tier => {
                  const msgs = allMessages.filter(m => m.tier === tier);
                  if (!msgs.length) return null;
                  const cfg = TIER_CONFIG[tier];
                  return (
                    <div key={tier}>
                      <div className={`px-4 py-1.5 flex items-center gap-2 ${cfg.headerBg}`}>
                        <span className={`text-xs font-semibold ${cfg.pillText}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                        <span className="text-xs text-gray-400">({msgs.length.toLocaleString()})</span>
                        <span className="text-xs text-gray-400 hidden sm:inline">— {cfg.description}</span>
                      </div>
                      <div className="px-4 divide-y divide-gray-50 max-h-60 overflow-y-auto">
                        {msgs.map((msg) => (
                          <ReviewEmailRow
                            key={msg.id}
                            msg={msg}
                            checked={selectedIds.has(msg.id)}
                            onToggle={toggleId}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Action button ── */}
        {isPro ? (
          <button
            onClick={triggerCleanup}
            disabled={isBusy || !selectedCount}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              selectedCount
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {buttonLabel}
          </button>

        ) : isFreeWithQuota && quotaRemaining > 0 ? (
          <div className="space-y-2">
            <button
              onClick={triggerCleanup}
              disabled={isBusy || !selectedCount}
              className={clsx(
                'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
                selectedCount
                  ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {buttonLabel}
            </button>
            {buttonCount > quotaRemaining && (
              <p className="text-xs text-center text-amber-600">
                You selected {buttonCount.toLocaleString()} emails. Free plan can delete {quotaRemaining.toLocaleString()} now.
              </p>
            )}
          </div>

        ) : isFreeWithQuota && quotaRemaining === 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center space-y-2">
            <p className="text-xs text-amber-700 font-semibold">Free quota used up</p>
            <p className="text-xs text-amber-600">You have reached your free deletion credits. Unlock a plan to continue cleanup.</p>
            <button
              onClick={triggerCleanup}
              className="w-full py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
            >
              Unlock cleanup
            </button>
          </div>

        ) : (
          <div className="bg-gradient-to-r from-brand-50 to-purple-50 border border-brand-100 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-600">
              <span className="font-semibold text-brand-700">Unlock a plan</span> to clean up
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
