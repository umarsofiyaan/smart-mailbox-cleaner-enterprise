// src/components/CleanupHistory.jsx
// Shows all cleanup actions with 30-day undo support.
// Greyed-out undo button with tooltip after 30 days.
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

function HistoryRow({ action, onUndo, undoingId }) {
  const canUndo = action.canUndo;
  const isUndoing = undoingId === action.id;
  const isUndone = action.status === 'undone';
  const timeLeft = canUndo ? timeUntilExpiry(action.expiresAt) : null;
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="flex items-center gap-4 py-4 border-b border-gray-50 last:border-0">
      {/* Icon */}
      <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-base flex-shrink-0">
        {CATEGORY_ICONS[action.category] || '📧'}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">
          {CATEGORY_LABELS[action.category] || action.category}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {action.messageCount?.toLocaleString()} emails &middot; {formatMB(action.bytesFreed)} freed &middot; {formatDate(action.executedAt)}
        </p>
        {timeLeft && (
          <p className="text-xs text-orange-500 mt-0.5 font-medium">{timeLeft}</p>
        )}
      </div>

      {/* Status / Undo button */}
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
            {isUndoing ? 'Restoring\u2026' : 'Undo'}
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
                  These emails are no longer in Trash. Gmail automatically purges Trash after 30 days and they cannot be recovered.
                </p>
                {/* Tooltip arrow */}
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
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await cleanupApi.getHistory();
      setHistory(res.data.history || []);
    } catch {
      // silently fail — history is bonus feature
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleUndo(actionId) {
    setUndoingId(actionId);
    setError('');
    try {
      await cleanupApi.undo(actionId);
      await load();
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
        <div className="flex items-center gap-3 mb-4">
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
      {/* Header */}
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
          {history.length} total
        </span>
      </div>

      {error && (
        <div className="mx-5 mt-4 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* History list */}
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

      {/* Footer note */}
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
        <p className="text-xs text-gray-400">
          &#8635; Emails are moved to Trash, not permanently deleted. Gmail purges Trash after 30 days.
        </p>
      </div>
    </div>
  );
}
