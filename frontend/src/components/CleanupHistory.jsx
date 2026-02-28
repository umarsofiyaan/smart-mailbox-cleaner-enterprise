// src/components/CleanupHistory.jsx
// Round 3: Paginated — loads 20 at a time with a "Load more" button.
// Previously loaded all records at once which would slow down for power users.

import { useState, useEffect, useCallback } from 'react';
import { cleanupApi } from '../api/client';

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
  large_attachments_5mb:  'Large attachments (5–10MB)',
  promotions_90d:         'Old promotional emails',
  social_90d:             'Old social notifications',
  old_emails_3yr:         'Emails older than 3 years',
  expired_calendar:       'Expired calendar invites',
  drive_attachments:      'Emails with Drive links',
};

const CATEGORY_ICONS = {
  large_attachments_10mb: '📎',
  large_attachments_5mb:  '📎',
  promotions_90d:         '🏷️',
  social_90d:             '👥',
  old_emails_3yr:         '🕐',
  expired_calendar:       '📅',
  drive_attachments:      '☁️',
};

const PAGE_SIZE = 5;

function HistoryRow({ action, onUndo, undoingId }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const canUndo   = action.canUndo;
  const isUndoing = undoingId === action.id;
  const isUndone  = action.status === 'undone';
  const timeLeft  = canUndo ? timeUntilExpiry(action.expiresAt) : null;

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
          {action.messageCount?.toLocaleString()} emails · {formatMB(action.bytesFreed)} freed · {formatDate(action.executedAt)}
        </p>
        {timeLeft && <p className="text-xs text-orange-500 mt-0.5 font-medium">{timeLeft}</p>}
      </div>

      <div className="flex-shrink-0 relative">
        {isUndone ? (
          <span className="text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">
            Restored
          </span>
        ) : canUndo ? (
          <button
            onClick={() => onUndo(action.id)}
            disabled={isUndoing}
            className="text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 hover:bg-brand-100 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {isUndoing ? 'Restoring…' : 'Undo'}
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
                <p className="font-semibold mb-0.5">Undo window expired</p>
                <p className="text-gray-300 leading-snug">
                  Gmail purges Trash after 30 days. These emails cannot be recovered.
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

export default function CleanupHistory({ onUndoSuccess }) {
  const [history,     setHistory]     = useState([]);
  const [total,       setTotal]       = useState(0);
  const [hasMore,     setHasMore]     = useState(false);
  const [offset,      setOffset]      = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [undoingId,   setUndoingId]   = useState(null);
  const [error,       setError]       = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res  = await cleanupApi.getHistory({ limit: PAGE_SIZE, offset: 0 });
      const data = res.data;
      setHistory(data.items || []);
      setTotal(data.total || 0);
      setHasMore(data.hasMore || false);
      setOffset(PAGE_SIZE);
    } catch {
      // silent — history is bonus feature
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    try {
      setLoadingMore(true);
      const res  = await cleanupApi.getHistory({ limit: PAGE_SIZE, offset });
      const data = res.data;
      setHistory(prev => [...prev, ...(data.items || [])]);
      setHasMore(data.hasMore || false);
      setOffset(prev => prev + PAGE_SIZE);
    } catch {
      // silent
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleUndo(actionId) {
    setUndoingId(actionId);
    setError('');
    try {
      await cleanupApi.undo(actionId);
      await load();           // reload from page 1 to reflect updated status
      onUndoSuccess?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Undo failed. Please try again.');
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

  if (history.length === 0) return null;

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
            {loadingMore ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin" />
                Loading…
              </span>
            ) : (
              `Load more (${total - history.length} remaining)`
            )}
          </button>
        </div>
      )}

      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          &#8635; Emails are moved to Trash, not permanently deleted. Gmail purges Trash after 30 days.
        </p>
      </div>
    </div>
  );
}
