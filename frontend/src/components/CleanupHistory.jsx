import { useState, useEffect, useCallback } from 'react';
import { cleanupApi } from '../api/client';

const BASE_PENDING_POLL_MS = 6000;
const MAX_PENDING_POLL_MS = 20000;

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function timeUntilExpiry(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return null;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 0) return `${days}d left to undo`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours > 0) return `${hours}h left to undo`;
  return 'Expiring soon';
}

const CATEGORY_LABELS = {
  large_attachments_10mb: 'Large attachments (10MB+)',
  large_attachments_5mb: 'Large attachments (5-10MB)',
  promotions_90d: 'Old promotional emails',
  social_90d: 'Old social notifications',
  old_emails_3yr: 'Emails older than 3 years',
  expired_calendar: 'Expired calendar invites',
  drive_attachments: 'Emails with Drive links',
  custom_filter: 'Custom filter',
};

const CATEGORY_ICONS = {
  large_attachments_10mb: '📎',
  large_attachments_5mb: '📎',
  promotions_90d: '🏷️',
  social_90d: '👥',
  old_emails_3yr: '🕐',
  expired_calendar: '📅',
  drive_attachments: '☁️',
  custom_filter: '🧪',
};

const PAGE_SIZE = 5;

const CLEANUP_STAGE_META = {
  checking_quota: {
    title: 'Checking cleanup limits',
    detail: 'We are validating your available cleanup credits before the job starts.',
  },
  connecting_mailbox: {
    title: 'Connecting to Gmail',
    detail: 'We are loading the mailbox session needed to run the cleanup safely.',
  },
  measuring_trash: {
    title: 'Measuring current Trash',
    detail: 'We are checking Trash totals so history can show the cleanup impact.',
  },
  resolving_ids: {
    title: 'Finding matching emails',
    detail: 'We are expanding your filter into the exact Gmail message IDs to clean.',
  },
  preparing_cleanup: {
    title: 'Preparing cleanup batches',
    detail: 'We are deduplicating results and splitting the cleanup into Gmail-safe batches.',
  },
  moving_to_trash: {
    title: 'Moving emails to Trash',
    detail: 'Deletion is now running in Gmail batch operations.',
  },
  saving_undo_snapshot: {
    title: 'Saving undo data',
    detail: 'We are recording original labels so Undo can restore messages more precisely.',
  },
  finalizing_cleanup: {
    title: 'Finalizing cleanup',
    detail: 'We are saving the cleanup summary and refreshing the final Gmail totals.',
  },
  done: {
    title: 'Cleanup complete',
    detail: 'The job finished successfully.',
  },
};

function getCleanupStageMessage(action) {
  const meta = CLEANUP_STAGE_META[action.progressStage] || {
    title: 'Processing cleanup',
    detail: 'The cleanup job is still running in the background.',
  };

  if (action.progressStage === 'moving_to_trash') {
    const moved = Number(action.progressMovedCount || action.messageCount || 0);
    const total = Number(action.progressTotalCount || action.progressMatchedCount || action.messageCount || 0);
    const failed = Number(action.progressFailedCount || 0);
    const parts = [
      `${moved.toLocaleString()} of ${Math.max(moved, total).toLocaleString()} moved`,
    ];
    if (failed > 0) parts.push(`${failed.toLocaleString()} failed`);
    return {
      title: meta.title,
      detail: `${parts.join(' - ')}. ${meta.detail}`,
      percent: total > 0 ? Math.min(100, Math.round((moved / total) * 100)) : null,
    };
  }

  if (action.progressMatchedCount > 0) {
    return {
      title: meta.title,
      detail: `${action.progressMatchedCount.toLocaleString()} emails identified so far. ${meta.detail}`,
      percent: null,
    };
  }

  return {
    title: meta.title,
    detail: meta.detail,
    percent: null,
  };
}

function HistoryRow({ action, onUndo, undoingId }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const canUndo = action.canUndo;
  const isUndoing = undoingId === action.id;
  const isUndone = action.status === 'undone';
  const isFailed = action.status === 'failed';
  const isPending = action.status === 'pending';
  const processedCount = action.processedCount || 0;
  const movedCount = action.movedCount || action.messageCount || 0;
  const conversationCount = action.conversationCount || 0;
  const trashConversationsBefore = action.trashConversationsBefore || 0;
  const estimatedNewConversationsInTrash = action.estimatedNewConversationsInTrash || 0;
  const sourceQuery = action.sourceQuery || '';
  const timeLeft = canUndo ? timeUntilExpiry(action.expiresAt) : null;
  const pendingStage = isPending ? getCleanupStageMessage(action) : null;

  return (
    <div className="flex items-center gap-4 py-4 border-b border-gray-50 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-base flex-shrink-0">
        {CATEGORY_ICONS[action.category] || '📧'}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {CATEGORY_LABELS[action.category] || action.category}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {(action.messageCount || 0).toLocaleString()} messages - {formatMB(action.bytesFreed)} freed - {formatDate(action.executedAt)}
        </p>
        {!isPending && processedCount > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            Processed {processedCount.toLocaleString()} messages - moved {movedCount.toLocaleString()} messages
            {conversationCount > 0 ? ` - ${conversationCount.toLocaleString()} conversations in Gmail` : ''}
          </p>
        )}
        {!isPending && trashConversationsBefore > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">
            Trash already had {trashConversationsBefore.toLocaleString()} conversations before this run
            {estimatedNewConversationsInTrash > 0
              ? ` (about ${estimatedNewConversationsInTrash.toLocaleString()} added by this run).`
              : '.'}
          </p>
        )}
        {!isPending && conversationCount > 0 && movedCount > conversationCount && (
          <p className="text-xs text-gray-400 mt-0.5">
            Gmail search shows total Trash conversations, not only this cleanup action.
          </p>
        )}
        {!isPending && sourceQuery && (
          <p className="text-xs text-gray-400 mt-0.5">
            Compare in Gmail by clearing filter chips and searching: <span className="font-mono">in:trash {sourceQuery}</span>
          </p>
        )}
        {isPending && (
          <div className="mt-1.5">
            <p className="text-xs text-indigo-700 font-semibold">{pendingStage.title}</p>
            <p className="text-xs text-indigo-600 mt-0.5">{pendingStage.detail}</p>
            {typeof pendingStage.percent === 'number' && (
              <div className="mt-2">
                <div className="w-full h-2 bg-indigo-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-500"
                    style={{ width: `${pendingStage.percent}%` }}
                  />
                </div>
                <p className="text-[11px] text-indigo-500 mt-1">{pendingStage.percent}% complete</p>
              </div>
            )}
          </div>
        )}
        {isFailed && (
          <p className="text-xs text-red-600 mt-0.5 font-medium">
            Failed: {action.errorMessage || 'Cleanup did not complete.'}
          </p>
        )}
        {timeLeft && <p className="text-xs text-orange-500 mt-0.5 font-medium">{timeLeft}</p>}
      </div>

      <div className="flex-shrink-0 relative">
        {isPending ? (
          <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg">Running</span>
        ) : isFailed ? (
          <span className="text-xs font-medium text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">Failed</span>
        ) : isUndone ? (
          <span className="text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">Restored</span>
        ) : canUndo ? (
          <button
            onClick={() => onUndo(action.id)}
            disabled={isUndoing}
            className="text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {isUndoing ? 'Restoring...' : 'Undo'}
          </button>
        ) : (
          <div
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <button
              disabled
              className="text-xs font-medium text-gray-300 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-lg cursor-not-allowed"
            >
              Undo
            </button>
            {showTooltip && (
              <div className="absolute right-0 bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded-xl px-3 py-2.5 shadow-xl z-10">
                <p className="font-semibold mb-0.5">Undo unavailable</p>
                <p className="text-gray-300 leading-snug">
                  {action.status === 'complete'
                    ? 'Undo window expired after 30 days.'
                    : 'This cleanup did not complete, so there is nothing to undo.'}
                </p>
                <div className="absolute right-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CleanupHistory({ onUndoSuccess, onStateChange }) {
  const [history, setHistory] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [undoingId, setUndoingId] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [pendingPollMs, setPendingPollMs] = useState(BASE_PENDING_POLL_MS);

  const load = useCallback(async () => {
    try {
      setLoading((prev) => prev && history.length === 0);
      setError('');
      setInfo('');
      const res = await cleanupApi.getHistory({ limit: PAGE_SIZE, offset: 0 });
      const data = res.data;
      setHistory(data.items || []);
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
      setOffset(PAGE_SIZE);
      setPendingPollMs(BASE_PENDING_POLL_MS);
    } catch (err) {
      const statusCode = err?.response?.status;
      if (statusCode === 429) {
        setInfo('Cleanup is still running. Slowing refresh checks to stay within API limits.');
        setPendingPollMs((prev) => Math.min(MAX_PENDING_POLL_MS, Math.max(BASE_PENDING_POLL_MS, prev * 2)));
        return;
      }
      setError(err?.response?.data?.error || 'Failed to load cleanup history.');
    } finally {
      setLoading(false);
    }
  }, [history.length]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    onStateChange?.(history);
  }, [history, onStateChange]);

  useEffect(() => {
    const hasPending = history.some(h => h.status === 'pending');
    if (!hasPending) return undefined;
    const timer = setInterval(() => {
      load();
    }, pendingPollMs);
    return () => clearInterval(timer);
  }, [history, load, pendingPollMs]);

  async function loadMore() {
    try {
      setLoadingMore(true);
      const res = await cleanupApi.getHistory({ limit: PAGE_SIZE, offset });
      const data = res.data;
      setHistory(prev => [...prev, ...(data.items || [])]);
      setHasMore(data.hasMore || false);
      setOffset(prev => prev + PAGE_SIZE);
    } catch {
      // keep current list
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleUndo(actionId) {
    setUndoingId(actionId);
    setError('');
    setInfo('');
    try {
      await cleanupApi.undo(actionId);
      await load();
      onUndoSuccess?.();
    } catch (err) {
      const statusCode = err?.response?.status;
      const msg = err?.response?.data?.error || err?.message || 'Undo failed.';
      if (statusCode === 409 || /already in progress/i.test(msg)) {
        setInfo('An undo is already in progress. Please wait and refresh Cleanup History.');
        setTimeout(() => { load(); }, 5000);
        return;
      }
      if (/timeout|ECONNABORTED|Network Error/i.test(msg)) {
        // Backend may still be restoring large batches. Refresh silently.
        setTimeout(() => { load(); }, 3000);
        setTimeout(() => { load(); }, 12000);
        return;
      }
      setError(msg);
    } finally {
      setUndoingId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-gray-200 border-t-brand-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">Loading cleanup history...</p>
        </div>
      </div>
    );
  }

  if (history.length === 0 && !error) return null;

  const activeCount = history.filter(h => h.canUndo).length;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Cleanup History</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {activeCount > 0
              ? `${activeCount} action${activeCount !== 1 ? 's' : ''} can still be undone`
              : 'All cleanup actions recorded here'}
          </p>
        </div>
        <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">
          {total} total
        </span>
      </div>

      {error && (
        <div className="mx-5 mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {info && (
        <div className="mx-5 mt-4 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-700">{info}</p>
        </div>
      )}

      <div className="px-5">
        {history.map(action => (
          <HistoryRow
            key={action.id}
            action={action}
            onUndo={handleUndo}
            undoingId={undoingId}
          />
        ))}
      </div>

      {hasMore && (
        <div className="px-5 py-4 border-t border-gray-50">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full text-sm text-brand-600 font-semibold hover:text-brand-700 py-2 rounded-xl hover:bg-brand-50 transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : `Load more (${total - history.length} remaining)`}
          </button>
        </div>
      )}

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          Emails are moved to Trash, not permanently deleted. Gmail purges Trash after 30 days.
        </p>
      </div>
    </div>
  );
}
