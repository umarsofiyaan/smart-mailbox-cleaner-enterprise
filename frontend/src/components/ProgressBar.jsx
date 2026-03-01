// src/components/ProgressBar.jsx
export default function ProgressBar({ status, messagesScanned }) {
  if (status !== 'running' && status !== 'starting') return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center gap-4">
        <div className="relative w-12 h-12 flex-shrink-0">
          <div className="w-12 h-12 rounded-full border-4 border-brand-100 border-t-brand-600 animate-spin" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">
            {status === 'starting' ? 'Connecting to Gmail...' : 'Scanning your mailbox...'}
          </p>
          <p className="text-sm text-gray-500 mt-0.5">
            {messagesScanned > 0
              ? `${messagesScanned.toLocaleString()} emails checked`
              : 'This takes 1-3 minutes for recent emails'}
          </p>
        </div>
      </div>

      {/* Animated shimmer bar */}
      <div className="mt-5 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-brand-300 via-brand-500 to-brand-300 rounded-full animate-[shimmer_2s_infinite] bg-[length:200%_100%]" />
      </div>

      <p className="text-xs text-gray-400 mt-3 text-center">
        We only look at email metadata - never your message content
      </p>
    </div>
  );
}
