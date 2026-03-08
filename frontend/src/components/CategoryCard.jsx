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
  PaperclipIcon: '??',
  TagIcon: '???',
  UsersIcon: '??',
  ClockIcon: '??',
  CalendarIcon: '??',
  CloudIcon: '??',
  AdjustmentsIcon: '???',
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

function ReviewEmailRow({ msg, checked, onToggle }) {
  const tierColor = {
    HIGH: 'bg-green-100 text-green-700',
    MEDIUM: 'bg-yellow-100 text-yellow-700',
    REVIEW_REQUIRED: 'bg-orange-100 text-orange-700',
  }[msg.tier] || 'bg-gray-100 text-gray-600';

  const tierLabel = {
    HIGH: 'Safe',
    MEDIUM: 'Likely safe',
    REVIEW_REQUIRED: 'Review',
  }[msg.tier] || msg.tier;

  return (
    <label className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 cursor-pointer">
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
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tierColor}`}>
          {tierLabel}
        </span>
        <span className="text-xs text-gray-400">{formatMB(msg.sizeEstimate)}</span>
      </div>
    </label>
  );
}

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

  const allMessages = category.messages || [];
  const allMessageIds = allMessages.map((m) => m.id);
  const [selectedIds, setSelectedIds] = useState(() => new Set(allMessageIds));

  useEffect(() => {
    setSelectedIds(new Set(allMessageIds));
  }, [category.key, category.messageCount]);

  if (category.messageCount === 0) return null;

  const selectedList = allMessageIds.filter((id) => selectedIds.has(id));
  const selectedCount = selectedList.length;
  const isQueryCleanup = category.cleanup?.mode === 'query' && !!category.cleanup?.query;
  const canDeleteAllByQuery = isQueryCleanup && selectedCount === allMessageIds.length;
  const hasMessages = allMessageIds.length > 0;
  const isBusy = isLoading || isLocked;

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

  function selectAll() {
    setSelectedIds(new Set(allMessageIds));
  }

  function clearAll() {
    setSelectedIds(new Set());
  }

  function triggerCleanup() {
    if (!selectedCount) return;
    const effectiveCount = !isPro && isFreeWithQuota && quotaRemaining > 0
      ? Math.min(selectedCount, quotaRemaining)
      : selectedCount;
    const selectedIdsCapped = (!isPro && isFreeWithQuota && quotaRemaining > 0)
      ? selectedList.slice(0, quotaRemaining)
      : selectedList;

    onCleanup({
      category: category.key,
      messageIds: canDeleteAllByQuery && effectiveCount === allMessageIds.length ? [] : selectedIdsCapped,
      estimatedBytes: selectedBytes,
      label: category.label,
      messageCount: effectiveCount,
      cleanupMode: canDeleteAllByQuery && effectiveCount === allMessageIds.length ? 'query' : 'ids',
      customQuery: canDeleteAllByQuery && effectiveCount === allMessageIds.length ? category.cleanup.query : null,
    });
  }

  return (
    <div className={clsx(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200',
      'border-gray-100 hover:shadow-md'
    )}>
      <div className={clsx('px-5 pt-5 pb-4', colors.bg)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center text-lg', colors.icon)}>
              {ICON_GLYPHS[category.icon] || '??'}
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm leading-tight">{category.label}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{category.description}</p>
            </div>
          </div>
          <ConfidenceBadge tier={category.tier} compact />
        </div>
      </div>

      <div className="px-5 py-4">
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

        <div className="flex flex-wrap gap-2 text-xs mb-4">
          {category.highCount > 0 && <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full">? {category.highCount} safe</span>}
          {category.mediumCount > 0 && <span className="bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">~ {category.mediumCount} likely safe</span>}
          {category.reviewCount > 0 && <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">! {category.reviewCount} need review</span>}
        </div>

        {hasMessages && (
          <>
            <button
              onClick={() => setReviewOpen((v) => !v)}
              className="w-full text-xs text-orange-600 hover:text-orange-700 font-medium text-left mb-3 flex items-center gap-1.5"
            >
              <span>??</span>
              {reviewOpen ? 'Hide' : 'View'} all {allMessageIds.length.toLocaleString()} result{allMessageIds.length !== 1 ? 's' : ''}
            </button>

            {reviewOpen && (
              <div className="mb-4 border border-orange-100 rounded-xl overflow-hidden">
                <div className="bg-orange-50 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs font-semibold text-orange-700">Select specific emails to delete</p>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={selectAll} className="text-orange-700 hover:underline">Select all</button>
                    <button onClick={clearAll} className="text-orange-700 hover:underline">Clear</button>
                    <span className="text-orange-500">{selectedCount.toLocaleString()} selected</span>
                    <button onClick={() => setReviewOpen(false)} className="text-orange-400 hover:text-orange-600 text-xl leading-none font-light">&times;</button>
                  </div>
                </div>
                <div className="px-4 divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {allMessages.map((msg) => (
                    <ReviewEmailRow key={msg.id} msg={msg} checked={selectedIds.has(msg.id)} onToggle={toggleId} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {isPro ? (
          <button
            onClick={triggerCleanup}
            disabled={isBusy || !selectedCount}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              selectedCount ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash...' : `Move to Trash (${selectedCount.toLocaleString()})`}
          </button>
        ) : isFreeWithQuota && quotaRemaining > 0 ? (
          <div className="space-y-2">
            <button
              onClick={triggerCleanup}
              disabled={isBusy || !selectedCount}
              className={clsx(
                'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
                selectedCount ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash...' : selectedCount <= quotaRemaining ? `Move to Trash (${selectedCount.toLocaleString()})` : `Move ${quotaRemaining.toLocaleString()} to Trash (quota limit)`}
            </button>
            {selectedCount > quotaRemaining && (
              <p className="text-xs text-center text-amber-600">
                You selected {selectedCount.toLocaleString()} emails. Free plan can delete {quotaRemaining.toLocaleString()} now.
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
            <p className="text-xs text-gray-600"><span className="font-semibold text-brand-700">Unlock a plan</span> to clean up</p>
          </div>
        )}
      </div>
    </div>
  );
}
