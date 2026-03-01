// src/components/ConfirmModal.jsx
import { clsx } from 'clsx';

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export default function ConfirmModal({ isOpen, onConfirm, onCancel, pending, isExecuting }) {
  if (!isOpen || !pending) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
        {/* Icon */}
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🗑️</span>
        </div>

        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
          Move to Trash?
        </h2>

        <p className="text-gray-500 text-center text-sm mb-6 leading-relaxed">
          This will move <strong className="text-gray-900">{pending.messageCount?.toLocaleString()} emails</strong> from
          <strong className="text-gray-900"> {pending.label}</strong> to your Trash,
          freeing up approximately <strong className="text-brand-600">{formatMB(pending.estimatedBytes)}</strong>.
        </p>

        {/* Safety note */}
        <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 mb-6">
          <div className="flex items-start gap-2">
            <span className="text-green-500 mt-0.5">🔒</span>
            <div>
              <p className="text-sm font-semibold text-green-800">You can undo this for 30 days</p>
              <p className="text-xs text-green-600 mt-0.5">
                Emails are moved to Trash, not permanently deleted. Gmail keeps Trash for 30 days.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isExecuting}
            className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isExecuting}
            className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isExecuting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Moving...
              </>
            ) : (
              'Move to Trash'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
