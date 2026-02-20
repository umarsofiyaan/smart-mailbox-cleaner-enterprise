// src/components/ConfidenceBadge.jsx
import { clsx } from 'clsx';

const TIER_CONFIG = {
  HIGH: {
    label: 'Safe to clean',
    sublabel: '95% confidence',
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    dot: 'bg-green-500',
  },
  MEDIUM: {
    label: 'Likely safe',
    sublabel: '80% confidence',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    dot: 'bg-yellow-400',
  },
  REVIEW_REQUIRED: {
    label: 'Review first',
    sublabel: 'Check before cleaning',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-700',
    dot: 'bg-orange-400',
  },
};

export default function ConfidenceBadge({ tier, compact = false }) {
  const config = TIER_CONFIG[tier] || TIER_CONFIG.MEDIUM;

  if (compact) {
    return (
      <span className={clsx(
        'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border',
        config.bg, config.border, config.text
      )}>
        <span className={clsx('w-1.5 h-1.5 rounded-full', config.dot)} />
        {config.label}
      </span>
    );
  }

  return (
    <div className={clsx('flex items-center gap-2 px-3 py-2 rounded-lg border', config.bg, config.border)}>
      <span className={clsx('w-2 h-2 rounded-full flex-shrink-0', config.dot)} />
      <div>
        <p className={clsx('text-sm font-semibold leading-tight', config.text)}>{config.label}</p>
        <p className={clsx('text-xs', config.text, 'opacity-75')}>{config.sublabel}</p>
      </div>
    </div>
  );
}
