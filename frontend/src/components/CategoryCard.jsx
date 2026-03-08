// src/components/CategoryCard.jsx
import { useState } from 'react';
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
};

const ICON_GLYPHS = {
  PaperclipIcon: '📎',
  TagIcon:       '🏷️',
  UsersIcon:     '👥',
  ClockIcon:     '🕐',
  CalendarIcon:  '📅',
  CloudIcon:     '☁️',
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
  return str.length > n ? str.slice(0, n) + '\u2026' : str;
}

function ReviewEmailRow({ msg }) {
  const tierColor = {
    HIGH:             'bg-green-100 text-green-700',
    MEDIUM:           'bg-yellow-100 text-yellow-700',
    REVIEW_REQUIRED:  'bg-orange-100 text-orange-700',
  }[msg.tier] || 'bg-gray-100 text-gray-600';

  const tierLabel = {
    HIGH:             '\u2713 Safe',
    MEDIUM:           '~ Likely safe',
    REVIEW_REQUIRED:  '! Review',
  }[msg.tier] || msg.tier;

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800 font-medium truncate leading-snug">
          {truncate(msg.subject, 60)}
        </p>
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {truncate(msg.from, 45)} &middot; {formatDate(msg.internalDate)}
        </p>
      </div>
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tierColor}`}>
          {tierLabel}
        </span>
        <span className="text-xs text-gray-400">{formatMB(msg.sizeEstimate)}</span>
      </div>
    </div>
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

  if (category.messageCount === 0) return null;

  const allMessageIds = category.messages?.map(m => m.id) || [];
  const isQueryCleanup = category.cleanup?.mode === 'query' && !!category.cleanup?.query;

  const reviewMessages = (category.messages || [])
    .filter(m => m.tier === 'REVIEW_REQUIRED')
    .slice(0, 50);

  const mediumMessages = (category.messages || [])
    .filter(m => m.tier === 'MEDIUM')
    .slice(0, 30);

  const showableMessages = [...reviewMessages, ...mediumMessages];
  const hasReviewEmails = showableMessages.length > 0;

  const isBusy = isLoading || isLocked;

  return (
    <div className={clsx(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200',
      'border-gray-100 hover:shadow-md'
    )}>
      {/* Header */}
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

      {/* Stats */}
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

        {/* Confidence breakdown - medium and review badges are clickable */}
        <div className="flex flex-wrap gap-2 text-xs mb-4">
          {category.highCount > 0 && (
            <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
              &#10003; {category.highCount} safe
            </span>
          )}
          {category.mediumCount > 0 && (
            <button
              onClick={() => setReviewOpen(v => !v)}
              className="bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full hover:bg-yellow-100 transition-colors underline-offset-2 hover:underline"
              title="Click to see these emails"
            >
              ~ {category.mediumCount} likely safe
            </button>
          )}
          {category.reviewCount > 0 && (
            <button
              onClick={() => setReviewOpen(v => !v)}
              className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full hover:bg-orange-100 transition-colors underline-offset-2 hover:underline"
              title="Click to see emails needing review"
            >
              ! {category.reviewCount} need review
            </button>
          )}
        </div>

        {/* Expandable review panel */}
        {hasReviewEmails && reviewOpen && (
          <div className="mb-4 border border-orange-100 rounded-xl overflow-hidden">
            <div className="bg-orange-50 px-4 py-2.5 flex items-center justify-between">
              <p className="text-xs font-semibold text-orange-700">
                Emails to check before deleting
              </p>
              <button
                onClick={() => setReviewOpen(false)}
                className="text-orange-400 hover:text-orange-600 text-xl leading-none font-light"
              >
                &times;
              </button>
            </div>
            <div className="px-4 divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {showableMessages.map(msg => (
                <ReviewEmailRow key={msg.id} msg={msg} />
              ))}
            </div>
            {showableMessages.length >= 50 && (
              <p className="text-xs text-gray-400 text-center px-4 py-2 bg-gray-50 border-t border-gray-100">
                Showing first 50 emails requiring attention
              </p>
            )}
          </div>
        )}

        {/* "View emails" prompt when panel is closed but review emails exist */}
        {hasReviewEmails && !reviewOpen && (
          <button
            onClick={() => setReviewOpen(true)}
            className="w-full text-xs text-orange-600 hover:text-orange-700 font-medium text-left mb-3 flex items-center gap-1.5"
          >
            <span>&#128065;</span>
            View {showableMessages.length} email{showableMessages.length !== 1 ? 's' : ''} that need attention before deleting &rarr;
          </button>
        )}

        {/* Action button - paid plan: full cleanup | Free with quota: capped | Exhausted: show unlock */}
        {isPro ? (
          <button
            onClick={() => onCleanup({
              category: category.key,
              messageIds: isQueryCleanup ? [] : allMessageIds,
              estimatedBytes: category.totalBytes,
              label: category.label,
              messageCount: category.messageCount,
              cleanupMode: isQueryCleanup ? 'query' : 'ids',
              customQuery: isQueryCleanup ? category.cleanup.query : null,
            })}
            disabled={isBusy || (!isQueryCleanup && allMessageIds.length === 0)}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              isQueryCleanup || allMessageIds.length > 0
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLocked
              ? 'Cleanup already running...'
              : isLoading
                ? 'Moving to Trash...'
                : `Move to Trash (${category.messageCount.toLocaleString()})`}
          </button>
        ) : isFreeWithQuota && quotaRemaining > 0 ? (
          // Free user with quota remaining
          <div className="space-y-2">
            <button
            onClick={() => onCleanup({
              category: category.key,
              messageIds: isQueryCleanup ? [] : allMessageIds.slice(0, quotaRemaining),
              estimatedBytes: category.totalBytes,
              label: category.label,
              messageCount: Math.min(category.messageCount, quotaRemaining),
              cleanupMode: isQueryCleanup ? 'query' : 'ids',
              customQuery: isQueryCleanup ? category.cleanup.query : null,
            })}
            disabled={isBusy || (!isQueryCleanup && allMessageIds.length === 0)}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              isQueryCleanup || allMessageIds.length > 0
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLocked
              ? 'Cleanup already running...'
              : isLoading
                ? 'Moving to Trash...'
                : category.messageCount <= quotaRemaining
                    ? `Move to Trash (${category.messageCount.toLocaleString()})`
                    : `Move ${quotaRemaining.toLocaleString()} to Trash (quota limit)`}
          </button>
            {category.messageCount > quotaRemaining && (
              <p className="text-xs text-center text-amber-600">
                You have {quotaRemaining} free credits. {category.messageCount - quotaRemaining} emails require a paid plan.
              </p>
            )}
          </div>
        ) : isFreeWithQuota && quotaRemaining === 0 ? (
          // Free user, quota exhausted
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center space-y-2">
            <p className="text-xs text-amber-700 font-semibold">Free quota used up</p>
            <p className="text-xs text-amber-600">You have reached your free deletion credits. Unlock a plan to continue cleanup.
			</p>
            <button
              onClick={() => onCleanup({
                category: category.key,
                messageIds: isQueryCleanup ? [] : allMessageIds,
                estimatedBytes: category.totalBytes,
                label: category.label,
                messageCount: category.messageCount,
                cleanupMode: isQueryCleanup ? 'query' : 'ids',
                customQuery: isQueryCleanup ? category.cleanup.query : null,
              })}
              className="w-full py-2 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
            >
              Unlock cleanup
            </button>
          </div>
        ) : (
          // No plan/quota info yet - show locked state
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
