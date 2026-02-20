// src/components/CategoryCard.jsx
import { useState } from 'react';
import { clsx } from 'clsx';
import ConfidenceBadge from './ConfidenceBadge';

const COLOR_MAP = {
  red: { bg: 'bg-red-50', icon: 'bg-red-100 text-red-600', border: 'border-red-100' },
  orange: { bg: 'bg-orange-50', icon: 'bg-orange-100 text-orange-600', border: 'border-orange-100' },
  purple: { bg: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600', border: 'border-purple-100' },
  blue: { bg: 'bg-blue-50', icon: 'bg-blue-100 text-blue-600', border: 'border-blue-100' },
  gray: { bg: 'bg-gray-50', icon: 'bg-gray-200 text-gray-600', border: 'border-gray-200' },
  green: { bg: 'bg-green-50', icon: 'bg-green-100 text-green-600', border: 'border-green-100' },
  teal: { bg: 'bg-teal-50', icon: 'bg-teal-100 text-teal-600', border: 'border-teal-100' },
};

const ICON_GLYPHS = {
  PaperclipIcon: '📎',
  TagIcon: '🏷️',
  UsersIcon: '👥',
  ClockIcon: '🕐',
  CalendarIcon: '📅',
  CloudIcon: '☁️',
};

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

export default function CategoryCard({ category, onCleanup, isPro, isLoading }) {
  const [selected, setSelected] = useState(false);
  const colors = COLOR_MAP[category.color] || COLOR_MAP.gray;

  if (category.messageCount === 0) return null;

  const allMessageIds = category.messages?.map(m => m.id) || [];

  return (
    <div className={clsx(
      'bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-200',
      selected ? 'ring-2 ring-brand-500 border-brand-300' : 'border-gray-100 hover:shadow-md'
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
            <p className="text-xs text-gray-400">emails</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-brand-600">{formatMB(category.totalBytes)}</p>
            <p className="text-xs text-gray-400">to free up</p>
          </div>
        </div>

        {/* Confidence breakdown */}
        <div className="flex gap-2 text-xs mb-4">
          {category.highCount > 0 && (
            <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
              ✓ {category.highCount} safe
            </span>
          )}
          {category.mediumCount > 0 && (
            <span className="bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full">
              ~ {category.mediumCount} likely safe
            </span>
          )}
          {category.reviewCount > 0 && (
            <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">
              ! {category.reviewCount} review
            </span>
          )}
        </div>

        {/* Action button */}
        {isPro ? (
          <button
            onClick={() => onCleanup({
              category: category.key,
              messageIds: allMessageIds,
              estimatedBytes: category.totalBytes,
              label: category.label,
              messageCount: category.messageCount,
            })}
            disabled={isLoading || allMessageIds.length === 0}
            className={clsx(
              'w-full py-2.5 rounded-xl text-sm font-semibold transition-all',
              allMessageIds.length > 0
                ? 'bg-brand-600 text-white hover:bg-brand-700 active:scale-95'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            )}
          >
            {isLoading ? 'Moving to Trash…' : `Move to Trash (${category.messageCount.toLocaleString()})`}
          </button>
        ) : (
          <div className="bg-gradient-to-r from-brand-50 to-purple-50 border border-brand-100 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-600">
              <span className="font-semibold text-brand-700">Pro required</span> to clean up
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
