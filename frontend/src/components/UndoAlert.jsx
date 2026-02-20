// src/components/UndoAlert.jsx
import { useEffect, useState } from 'react';
import { clsx } from 'clsx';

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export default function UndoAlert({ action, onUndo, onDismiss, isUndoing }) {
  const [visible, setVisible] = useState(false);
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (!action) return;
    setVisible(true);
    setCountdown(10);

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setVisible(false);
          onDismiss?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [action]);

  if (!action || !visible) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl px-5 py-4 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">
            ✓ {action.successCount?.toLocaleString()} emails moved to Trash
          </p>
          <p className="text-gray-400 text-xs mt-0.5">
            Freed ~{formatMB(action.bytesFreed)} · Undoable for 30 days
          </p>
        </div>

        <button
          onClick={() => {
            setVisible(false);
            onUndo(action.actionId);
          }}
          disabled={isUndoing}
          className={clsx(
            'flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-colors',
            isUndoing
              ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
              : 'bg-white text-gray-900 hover:bg-gray-100'
          )}
        >
          {isUndoing ? 'Undoing…' : `Undo (${countdown}s)`}
        </button>
      </div>
    </div>
  );
}
