import { useEffect, useMemo, useState, useRef } from 'react';
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

// ── Tier definitions with tooltip explanations ───────────────────────────────

const TIER_INFO = {
  HIGH: {
    label:  'Safe to Delete',
    emoji:  '✅',
    pill:   'bg-green-50 text-green-700',
    header: 'bg-green-50 border-green-100',
    // Plain-language explanation shown in the info tooltip
    tooltip: [
      'No important signals were found on these emails.',
      '• Not starred or manually labelled by you',
      '• Not marked Important by Gmail',
      '• Not sitting unread in your Inbox',
      '• Sender looks automated (newsletter/notification)',
      '• Email is old or from a bulk-mail category',
      'These are very likely safe to delete in bulk.',
    ],
  },
  MEDIUM: {
    label:  'Likely Safe',
    emoji:  '⚠️',
    pill:   'bg-yellow-50 text-yellow-700',
    header: 'bg-yellow-50 border-yellow-100',
    tooltip: [
      'Some minor signals were found — probably fine to delete, but worth a quick scroll.',
      '• May be sitting in your Inbox (read, but not archived)',
      '• Could be part of a short thread (1–2 replies)',
      '• Gmail may have marked it Important',
      '• Could be a recent email (under 30 days old)',
      'We recommend a quick glance before deleting.',
    ],
  },
  REVIEW_REQUIRED: {
    label:  'Needs Review',
    emoji:  '🔍',
    pill:   'bg-orange-50 text-orange-700',
    header: 'bg-orange-50 border-orange-100',
    tooltip: [
      'Strong signals suggest these may be important to you.',
      '• Starred by you — you explicitly saved it',
      '• Unread in your Inbox — you haven\'t seen it yet',
      '• Marked Important + still in Inbox by Gmail',
      '• Part of an active thread (4+ messages)',
      '• Has a custom label you created',
      'Review individually before deleting — unchecking them excludes them.',
    ],
  },
};

// ── Tooltip component ────────────────────────────────────────────────────────

function InfoTooltip({ tier }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  const info = TIER_INFO[tier];
  if (!info) return null;

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="ml-1 w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 hover:text-gray-700 inline-flex items-center justify-center text-[10px] font-bold leading-none flex-shrink-0 cursor-help focus:outline-none"
        aria-label={`How we decided "${info.label}"`}
      >
        i
      </button>

      {visible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-gray-900 text-white rounded-xl shadow-2xl p-3 pointer-events-none">
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />

          <p className="text-xs font-semibold mb-1.5">
            How we decide "{info.label}"
          </p>
          {info.tooltip.map((line, i) => (
            <p key={i} className={clsx('text-xs leading-relaxed', i === 0 ? 'text-gray-300 mb-1.5' : 'text-gray-400')}>
              {line}
            </p>
          ))}
        </div>
      )}
    </span>
  );
}

// ── Format helpers ───────────────────────────────────────────────────────────

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

// ── Single email row ─────────────────────────────────────────────────────────

function EmailRow({ msg, checked, onToggle }) {
  const info = TIER_INFO[msg.tier] || TIER_INFO.REVIEW_REQUIRED;

  return (
    <label className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/50">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(msg.id)}
        className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 flex-shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 font-medium truncate leading-snug">
          {truncate(msg.subject, 80)}
        </p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {truncate(msg.from, 55)} · {formatDate(msg.internalDate)}
        </p>
        {/* Signal chips for review-required emails */}
        {msg.tier === 'REVIEW_REQUIRED' && msg.signals && (
          <div className="flex flex-wrap gap-1 mt-1">
            {msg.signals.starred       && <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded">⭐ Starred</span>}
            {msg.signals.unreadInbox   && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded">📬 Unread</span>}
            {msg.signals.importantInInbox && <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">📌 Important</span>}
            {msg.signals.activeThread  && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">💬 {msg.signals.threadCount} replies</span>}
            {msg.signals.hasCustomLabel && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">🏷️ Labelled</span>}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${info.pill}`}>
          {info.emoji} {info.label}
        </span>
        <span className="text-xs text-gray-400">{formatMB(msg.sizeEstimate)}</span>
      </div>
    </label>
  );
}

// ── Tier section (collapsible group) ─────────────────────────────────────────

function TierSection({ tier, messages, selectedIds, onToggle, onSelectAll, onClearAll }) {
  const [open, setOpen] = useState(false);
  const info = TIER_INFO[tier];
  const selectedCount = messages.filter(m => selectedIds.has(m.id)).length;
  const allSelected = selectedCount === messages.length;

  if (messages.length === 0) return null;

  return (
    <div className={clsx('border rounded-xl overflow-hidden mb-2', info.header)}>
      {/* Section header — always visible */}
      <div
        className={clsx('px-4 py-2.5 flex items-center justify-between gap-2 cursor-pointer select-none', info.header)}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm">{info.emoji}</span>
          <span className="text-xs font-semibold text-gray-800">{info.label}</span>
          <span className="text-xs text-gray-500">({messages.length.toLocaleString()})</span>
          <InfoTooltip tier={tier} />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Quick select buttons — stop propagation so they don't toggle the accordion */}
          <button
            onClick={e => { e.stopPropagation(); allSelected ? onClearAll(messages) : onSelectAll(messages); }}
            className="text-[10px] font-medium text-gray-500 hover:text-gray-700 underline"
          >
            {allSelected ? 'Deselect' : 'Select all'}
          </button>
          <span className="text-[10px] text-gray-400">{selectedCount}/{messages.length} selected</span>
          <svg
            className={clsx('w-4 h-4 text-gray-400 transition-transform duration-150', open && 'rotate-180')}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Email rows */}
      {open && (
        <div className="bg-white px-4 divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {messages.map(msg => (
            <EmailRow
              key={msg.id}
              msg={msg}
              checked={selectedIds.has(msg.id)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main CategoryCard ─────────────────────────────────────────────────────────

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

  const allMessages   = category.messages || [];
  const allMessageIds = allMessages.map(m => m.id);
  const [selectedIds, setSelectedIds] = useState(() => new Set(allMessageIds));

  useEffect(() => {
    setSelectedIds(new Set(allMessageIds));
  }, [category.key, category.messageCount]);

  if (category.messageCount === 0) return null;

  // For query-based cleanup: backend re-runs the Gmail query and deletes ALL
  // matching emails, not just the ones in the preview array.
  const isQueryCleanup      = category.cleanup?.mode === 'query' && !!category.cleanup?.query;
  const selectedList        = allMessageIds.filter(id => selectedIds.has(id));
  const selectedCount       = selectedList.length;
  const canDeleteAllByQuery = isQueryCleanup && selectedCount === allMessageIds.length;

  const isBusy = isLoading || isLocked;

  // Group messages by tier for the accordion
  const byTier = {
    HIGH:             allMessages.filter(m => m.tier === 'HIGH'),
    MEDIUM:           allMessages.filter(m => m.tier === 'MEDIUM'),
    REVIEW_REQUIRED:  allMessages.filter(m => m.tier === 'REVIEW_REQUIRED'),
  };

  const selectedBytes = useMemo(() => {
    if (selectedCount === allMessageIds.length) return category.totalBytes;
    return allMessages
      .filter(m => selectedIds.has(m.id))
      .reduce((sum, m) => sum + Number(m.sizeEstimate || 0), 0);
  }, [allMessages, allMessageIds.length, category.totalBytes, selectedCount, selectedIds]);

  function toggleId(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAllMessages(msgs) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      msgs.forEach(m => next.add(m.id));
      return next;
    });
  }

  function clearMessages(msgs) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      msgs.forEach(m => next.delete(m.id));
      return next;
    });
  }

  function selectAll() { setSelectedIds(new Set(allMessageIds)); }
  function clearAll()  { setSelectedIds(new Set()); }

  function triggerCleanup() {
    if (!selectedCount) return;
    const effectiveTotalCount = canDeleteAllByQuery ? category.messageCount : selectedCount;
    const effectiveCount = !isPro && isFreeWithQuota && quotaRemaining > 0
      ? Math.min(effectiveTotalCount, quotaRemaining)
      : effectiveTotalCount;
    const selectedIdsCapped = (!isPro && isFreeWithQuota && quotaRemaining > 0)
      ? selectedList.slice(0, quotaRemaining)
      : selectedList;
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

  const buttonDisplayCount = canDeleteAllByQuery ? category.messageCount : selectedCount;

  // Counts — use real tier counts from the backend (now accurate for all emails)
  const highCount   = category.highCount   || 0;
  const mediumCount = category.mediumCount || 0;
  const reviewCount = category.reviewCount || 0;

  return (
    <div className={clsx(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200',
      'border-gray-100 hover:shadow-md'
    )}>

      {/* ── Header ── */}
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

      {/* ── Body ── */}
      <div className="px-5 py-4">

        {/* Totals row */}
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

        {/* ── Severity pills with info tooltips ── */}
        <div className="flex flex-wrap gap-2 text-xs mb-4">
          {highCount > 0 && (
            <span className="inline-flex items-center bg-green-50 text-green-700 px-2.5 py-0.5 rounded-full font-medium">
              ✅ {highCount.toLocaleString()} safe
              <InfoTooltip tier="HIGH" />
            </span>
          )}
          {mediumCount > 0 && (
            <span className="inline-flex items-center bg-yellow-50 text-yellow-700 px-2.5 py-0.5 rounded-full font-medium">
              ⚠️ {mediumCount.toLocaleString()} likely safe
              <InfoTooltip tier="MEDIUM" />
            </span>
          )}
          {reviewCount > 0 && (
            <span className="inline-flex items-center bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-full font-medium">
              🔍 {reviewCount.toLocaleString()} need review
              <InfoTooltip tier="REVIEW_REQUIRED" />
            </span>
          )}
        </div>

        {/* ── View / Review accordion ── */}
        {allMessages.length > 0 && (
          <>
            <button
              onClick={() => setReviewOpen(v => !v)}
              className="w-full text-xs text-orange-600 hover:text-orange-700 font-medium text-left mb-3 flex items-center gap-1.5"
            >
              <span>👁️</span>
              {reviewOpen ? 'Hide' : 'View'} all {category.messageCount.toLocaleString()} emails
            </button>

            {reviewOpen && (
              <div className="mb-4">
                {/* Global select / clear */}
                <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                  <span>{selectedCount.toLocaleString()} of {allMessageIds.length.toLocaleString()} selected</span>
                  <div className="flex gap-3">
                    <button onClick={selectAll} className="text-indigo-600 hover:underline font-medium">Select all</button>
                    <button onClick={clearAll}  className="text-indigo-600 hover:underline font-medium">Clear all</button>
                  </div>
                </div>

                {/* 3 accordion sections — one per tier */}
                <TierSection
                  tier="HIGH"
                  messages={byTier.HIGH}
                  selectedIds={selectedIds}
                  onToggle={toggleId}
                  onSelectAll={selectAllMessages}
                  onClearAll={clearMessages}
                />
                <TierSection
                  tier="MEDIUM"
                  messages={byTier.MEDIUM}
                  selectedIds={selectedIds}
                  onToggle={toggleId}
                  onSelectAll={selectAllMessages}
                  onClearAll={clearMessages}
                />
                <TierSection
                  tier="REVIEW_REQUIRED"
                  messages={byTier.REVIEW_REQUIRED}
                  selectedIds={selectedIds}
                  onToggle={toggleId}
                  onSelectAll={selectAllMessages}
                  onClearAll={clearMessages}
                />
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
            {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash...' : `Move to Trash (${buttonDisplayCount.toLocaleString()})`}
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
              {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash...'
                : buttonDisplayCount <= quotaRemaining
                  ? `Move to Trash (${buttonDisplayCount.toLocaleString()})`
                  : `Move ${quotaRemaining.toLocaleString()} to Trash (quota limit)`}
            </button>
            {buttonDisplayCount > quotaRemaining && (
              <p className="text-xs text-center text-amber-600">
                {buttonDisplayCount.toLocaleString()} emails found. Free plan can delete {quotaRemaining.toLocaleString()} now.
              </p>
            )}
          </div>

        ) : isFreeWithQuota && quotaRemaining === 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center space-y-2">
            <p className="text-xs text-amber-700 font-semibold">Free quota used up</p>
            <p className="text-xs text-amber-600">Unlock a plan to continue cleanup.</p>
            <button onClick={triggerCleanup} className="w-full py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">
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
