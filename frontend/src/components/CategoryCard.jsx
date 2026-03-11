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

// ── Tier definitions + tooltips ───────────────────────────────────────────────

const TIER_INFO = {
  HIGH: {
    label:  'Safe to Delete',
    emoji:  '✅',
    pill:   'bg-green-50 text-green-700',
    header: 'bg-green-50 border-green-100',
    tooltip: [
      'No important signals found — these are very likely safe to bulk-delete.',
      '• Not starred or custom-labelled by you',
      '• Not marked Important by Gmail',
      '• Not sitting unread in your Inbox',
      '• Sender looks automated (newsletter / noreply)',
      '• Email is old or clearly from a bulk category',
    ],
  },
  MEDIUM: {
    label:  'Likely Safe',
    emoji:  '⚠️',
    pill:   'bg-yellow-50 text-yellow-700',
    header: 'bg-yellow-50 border-yellow-100',
    tooltip: [
      'Minor signals found — probably fine to delete, but worth a quick scroll.',
      '• May still be in your Inbox (read but not archived)',
      '• Could be part of a short reply thread (2–3 messages)',
      '• Gmail may have marked it as Important',
      '• Could be a recent email (under 30 days old)',
    ],
  },
  REVIEW_REQUIRED: {
    label:  'Needs Review',
    emoji:  '🔍',
    pill:   'bg-orange-50 text-orange-700',
    header: 'bg-orange-50 border-orange-100',
    tooltip: [
      'Strong signals suggest these may be important.',
      '• Starred by you — you explicitly saved it',
      '• Unread in your Inbox — you haven\'t seen it yet',
      '• Marked Important + still in Inbox by Gmail',
      '• Active thread with 4+ messages',
      '• Has a custom label you created',
      'Uncheck any you want to keep before deleting.',
    ],
  },
};

// ── Tooltip ───────────────────────────────────────────────────────────────────

function InfoTooltip({ tier }) {
  const [visible, setVisible] = useState(false);
  const info = TIER_INFO[tier];
  if (!info) return null;

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        className="ml-1 w-4 h-4 rounded-full bg-gray-200 text-gray-500 hover:bg-gray-300 hover:text-gray-700 inline-flex items-center justify-center text-[10px] font-bold leading-none flex-shrink-0 cursor-help focus:outline-none"
        aria-label={`Why "${info.label}"?`}
      >
        i
      </button>

      {visible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-gray-900 text-white rounded-xl shadow-2xl p-3 pointer-events-none">
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
          <p className="text-xs font-semibold mb-1.5">How we decide "{info.label}"</p>
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(Number(ts)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function truncate(str, n) {
  if (!str) return '(no subject)';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Email row ─────────────────────────────────────────────────────────────────

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
        <p className="text-sm text-gray-800 font-medium truncate leading-snug">{truncate(msg.subject, 80)}</p>
        <p className="text-xs text-gray-400 truncate mt-0.5">{truncate(msg.from, 55)} · {formatDate(msg.internalDate)}</p>
        {msg.tier === 'REVIEW_REQUIRED' && msg.signals && (
          <div className="flex flex-wrap gap-1 mt-1">
            {msg.signals.starred          && <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded">⭐ Starred</span>}
            {msg.signals.unreadInbox      && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded">📬 Unread</span>}
            {msg.signals.importantInInbox && <span className="text-[10px] bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">📌 Important</span>}
            {msg.signals.activeThread     && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">💬 {msg.signals.threadCount} replies</span>}
            {msg.signals.hasCustomLabel   && <span className="text-[10px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">🏷️ Labelled</span>}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${info.pill}`}>{info.emoji} {info.label}</span>
        <span className="text-xs text-gray-400">{formatMB(msg.sizeEstimate)}</span>
      </div>
    </label>
  );
}

// ── Tier section (collapsible) ────────────────────────────────────────────────

function TierSection({ tier, messages, selectedIds, onToggle, onSelectAll, onClearAll }) {
  const [open, setOpen] = useState(false);
  const info = TIER_INFO[tier];
  const selCount = messages.filter(m => selectedIds.has(m.id)).length;
  const allSel = selCount === messages.length;
  if (!messages.length) return null;

  return (
    <div className={clsx('border rounded-xl overflow-hidden mb-2', info.header)}>
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
          <button
            onClick={e => { e.stopPropagation(); allSel ? onClearAll(messages) : onSelectAll(messages); }}
            className="text-[10px] font-medium text-gray-500 hover:text-gray-700 underline"
          >
            {allSel ? 'Deselect' : 'Select all'}
          </button>
          <span className="text-[10px] text-gray-400">{selCount}/{messages.length}</span>
          <svg className={clsx('w-4 h-4 text-gray-400 transition-transform duration-150', open && 'rotate-180')} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      {open && (
        <div className="bg-white px-4 divide-y divide-gray-50 max-h-72 overflow-y-auto">
          {messages.map(msg => (
            <EmailRow key={msg.id} msg={msg} checked={selectedIds.has(msg.id)} onToggle={onToggle} />
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

  const isQueryCleanup = category.cleanup?.mode === 'query' && !!category.cleanup?.query;

  // How many emails from the loaded preview are checked/unchecked
  const selectedList    = allMessageIds.filter(id => selectedIds.has(id));
  const selectedCount   = selectedList.length;
  const deselectedCount = allMessageIds.length - selectedCount;  // emails the user unchecked

  // Whether the preview is a sample (old scan) or covers all emails
  const isSampled = allMessageIds.length < category.messageCount;

  const isBusy = isLoading || isLocked;

  const byTier = {
    HIGH:            allMessages.filter(m => m.tier === 'HIGH'),
    MEDIUM:          allMessages.filter(m => m.tier === 'MEDIUM'),
    REVIEW_REQUIRED: allMessages.filter(m => m.tier === 'REVIEW_REQUIRED'),
  };

  const selectedBytes = useMemo(() => {
    if (selectedCount === allMessageIds.length) return category.totalBytes;
    return allMessages
      .filter(m => selectedIds.has(m.id))
      .reduce((sum, m) => sum + Number(m.sizeEstimate || 0), 0);
  }, [allMessages, allMessageIds.length, category.totalBytes, selectedCount, selectedIds]);

  function toggleId(id) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllMsgs(msgs) { setSelectedIds(prev => { const n = new Set(prev); msgs.forEach(m => n.add(m.id)); return n; }); }
  function clearMsgs(msgs)     { setSelectedIds(prev => { const n = new Set(prev); msgs.forEach(m => n.delete(m.id)); return n; }); }
  function selectAll()         { setSelectedIds(new Set(allMessageIds)); }
  function clearAll()          { setSelectedIds(new Set()); }

  // ── Button count ─────────────────────────────────────────────────────────
  // For query-based cleanup the Gmail search re-runs on the backend and deletes
  // every matching email. So the count is always the full category.messageCount
  // minus any emails the user explicitly unchecked from the preview.
  // Example: 3,578 total, user unchecks 1 → button shows 3,577.
  const buttonDisplayCount = isQueryCleanup
    ? Math.max(0, category.messageCount - deselectedCount)
    : selectedCount;

  // ── Cleanup action ────────────────────────────────────────────────────────
  function triggerCleanup() {
    if (buttonDisplayCount === 0) return;

    const effectiveCount = !isPro && isFreeWithQuota && quotaRemaining > 0
      ? Math.min(buttonDisplayCount, quotaRemaining)
      : buttonDisplayCount;

    if (isQueryCleanup && deselectedCount === 0) {
      // All selected — use query mode: fast, re-runs Gmail search on backend
      onCleanup({
        category:       category.key,
        messageIds:     [],
        estimatedBytes: category.totalBytes,
        label:          category.label,
        messageCount:   effectiveCount,
        cleanupMode:    'query',
        customQuery:    category.cleanup.query,
      });
    } else if (isQueryCleanup && deselectedCount > 0 && !isSampled) {
      // All emails loaded + some unchecked → ID mode with exact selected IDs
      const capIds = (!isPro && isFreeWithQuota && quotaRemaining > 0)
        ? selectedList.slice(0, quotaRemaining)
        : selectedList;
      onCleanup({
        category:       category.key,
        messageIds:     capIds,
        estimatedBytes: selectedBytes,
        label:          category.label,
        messageCount:   effectiveCount,
        cleanupMode:    'ids',
        customQuery:    null,
      });
    } else if (isQueryCleanup && deselectedCount > 0 && isSampled) {
      // Partial selection from sampled preview — use query mode anyway.
      // The deselected count is tracked in messageCount so the quota reflects it.
      // A banner below informs the user to re-scan for full individual control.
      onCleanup({
        category:       category.key,
        messageIds:     [],
        estimatedBytes: category.totalBytes,
        label:          category.label,
        messageCount:   effectiveCount,
        cleanupMode:    'query',
        customQuery:    category.cleanup.query,
      });
    } else {
      // ID mode (non-query category)
      const capIds = (!isPro && isFreeWithQuota && quotaRemaining > 0)
        ? selectedList.slice(0, quotaRemaining)
        : selectedList;
      onCleanup({
        category:       category.key,
        messageIds:     capIds,
        estimatedBytes: selectedBytes,
        label:          category.label,
        messageCount:   effectiveCount,
        cleanupMode:    'ids',
        customQuery:    null,
      });
    }
  }

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

        {/* Totals */}
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

        {/* Severity pills */}
        <div className="flex flex-wrap gap-2 text-xs mb-4">
          {highCount > 0 && (
            <span className="inline-flex items-center bg-green-50 text-green-700 px-2.5 py-0.5 rounded-full font-medium">
              ✅ {highCount.toLocaleString()} safe<InfoTooltip tier="HIGH" />
            </span>
          )}
          {mediumCount > 0 && (
            <span className="inline-flex items-center bg-yellow-50 text-yellow-700 px-2.5 py-0.5 rounded-full font-medium">
              ⚠️ {mediumCount.toLocaleString()} likely safe<InfoTooltip tier="MEDIUM" />
            </span>
          )}
          {reviewCount > 0 && (
            <span className="inline-flex items-center bg-orange-50 text-orange-700 px-2.5 py-0.5 rounded-full font-medium">
              🔍 {reviewCount.toLocaleString()} need review<InfoTooltip tier="REVIEW_REQUIRED" />
            </span>
          )}
        </div>

        {/* Sampled notice — shown only on old scan data */}
        {isSampled && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
            <span className="text-xs text-indigo-600 mt-0.5 flex-shrink-0">ℹ️</span>
            <p className="text-xs text-indigo-700 leading-snug">
              Preview shows <strong>{allMessageIds.length.toLocaleString()}</strong> of <strong>{category.messageCount.toLocaleString()}</strong> emails (older scan data).
              {' '}<strong>Run a new scan</strong> to load all emails for full individual control.
              The delete button will still process all <strong>{category.messageCount.toLocaleString()}</strong>.
            </p>
          </div>
        )}

        {/* Deselected warning when sampled */}
        {isSampled && deselectedCount > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-amber-700 leading-snug">
              ⚠️ You unchecked <strong>{deselectedCount}</strong> email{deselectedCount > 1 ? 's' : ''} from the preview.
              The delete button shows <strong>{buttonDisplayCount.toLocaleString()}</strong>.
              For precise exclusions across all {category.messageCount.toLocaleString()} emails, re-scan first.
            </p>
          </div>
        )}

        {/* View accordion */}
        {allMessages.length > 0 && (
          <>
            <button
              onClick={() => setReviewOpen(v => !v)}
              className="w-full text-xs text-orange-600 hover:text-orange-700 font-medium text-left mb-3 flex items-center gap-1.5"
            >
              <span>👁️</span>
              {reviewOpen ? 'Hide' : 'View all'} {category.messageCount.toLocaleString()} emails
            </button>

            {reviewOpen && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2 text-xs text-gray-500">
                  <span>
                    {deselectedCount > 0
                      ? <><strong className="text-amber-600">{deselectedCount} unchecked</strong> · {selectedCount.toLocaleString()} of {allMessageIds.length.toLocaleString()} shown selected</>
                      : <>{allMessageIds.length.toLocaleString()} shown{isSampled ? ` (preview of ${category.messageCount.toLocaleString()})` : ''}</>
                    }
                  </span>
                  <div className="flex gap-3">
                    <button onClick={selectAll} className="text-indigo-600 hover:underline font-medium">Select all</button>
                    <button onClick={clearAll}  className="text-indigo-600 hover:underline font-medium">Clear all</button>
                  </div>
                </div>

                <TierSection tier="HIGH"            messages={byTier.HIGH}            selectedIds={selectedIds} onToggle={toggleId} onSelectAll={selectAllMsgs} onClearAll={clearMsgs} />
                <TierSection tier="MEDIUM"          messages={byTier.MEDIUM}          selectedIds={selectedIds} onToggle={toggleId} onSelectAll={selectAllMsgs} onClearAll={clearMsgs} />
                <TierSection tier="REVIEW_REQUIRED" messages={byTier.REVIEW_REQUIRED} selectedIds={selectedIds} onToggle={toggleId} onSelectAll={selectAllMsgs} onClearAll={clearMsgs} />
              </div>
            )}
          </>
        )}

        {/* Action button */}
        {isPro ? (
          <button
            onClick={triggerCleanup}
            disabled={isBusy || buttonDisplayCount === 0}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              buttonDisplayCount > 0
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash…' : `Move to Trash (${buttonDisplayCount.toLocaleString()})`}
          </button>

        ) : isFreeWithQuota && quotaRemaining > 0 ? (
          <div className="space-y-2">
            <button
              onClick={triggerCleanup}
              disabled={isBusy || buttonDisplayCount === 0}
              className={clsx(
                'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
                buttonDisplayCount > 0
                  ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              )}
            >
              {isLocked ? 'Cleanup already running...' : isLoading ? 'Moving to Trash…'
                : buttonDisplayCount <= quotaRemaining
                  ? `Move to Trash (${buttonDisplayCount.toLocaleString()})`
                  : `Move ${quotaRemaining.toLocaleString()} to Trash (quota limit)`}
            </button>
            {buttonDisplayCount > quotaRemaining && (
              <p className="text-xs text-center text-amber-600">
                {buttonDisplayCount.toLocaleString()} emails selected. Free plan deletes {quotaRemaining.toLocaleString()} now.
              </p>
            )}
          </div>

        ) : isFreeWithQuota && quotaRemaining === 0 ? (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center space-y-2">
            <p className="text-xs text-amber-700 font-semibold">Free quota used up</p>
            <p className="text-xs text-amber-600">Unlock a plan to continue cleanup.</p>
            <button onClick={triggerCleanup} className="w-full py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700">Unlock cleanup</button>
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
