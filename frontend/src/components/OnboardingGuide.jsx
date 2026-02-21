// src/components/OnboardingGuide.jsx
// Shown to first-time users before they do anything.
// Guides them to enable 2SV and Gmail API.
import { useState } from 'react';

const STEPS = [
  {
    id: 'welcome',
    emoji: '👋',
    title: 'Welcome to Smart Mailbox Cleaner!',
    subtitle: 'Before you start, let\'s make sure your account is set up correctly. This takes about 2 minutes.',
    content: null,
    cta: 'Get Started',
  },
  {
    id: '2sv',
    emoji: '🔐',
    title: 'Step 1 — Enable 2-Step Verification',
    subtitle: 'Google requires 2-Step Verification (2SV) to be enabled before third-party apps like this one can access your Gmail.',
    content: [
      'Go to your Google Account security settings',
      'Find "2-Step Verification" and click it',
      'Follow Google\'s steps to enable it (takes ~2 min)',
      'Come back here when done',
    ],
    link: { href: 'https://myaccount.google.com/signinoptions/two-step-verification', label: 'Open Google 2SV Settings \u2192' },
    cta: 'I\'ve enabled 2SV',
    skip: 'Already enabled, skip',
  },
  {
    id: 'gmail-api',
    emoji: '⚙️',
    title: 'Step 2 — Enable Gmail API Access',
    subtitle: 'You need to allow third-party apps to access Gmail. This is controlled in your Google Account settings.',
    content: [
      'Go to your Google Account → Security',
      'Scroll to "Third-party apps with account access"',
      'Make sure "Allow less secure apps" or API access is NOT blocked',
      'If you see a warning about API access, click "Allow"',
    ],
    link: { href: 'https://myaccount.google.com/security', label: 'Open Google Security Settings \u2192' },
    note: 'If your scan fails after this, it means Gmail API is blocked by your organization (Google Workspace). Contact your IT admin.',
    cta: 'I\'ve checked this',
    skip: 'Skip this step',
  },
  {
    id: 'done',
    emoji: '✅',
    title: 'You\'re all set!',
    subtitle: 'Your account is ready. Click "Start Scan" on the dashboard to analyze your mailbox.',
    content: null,
    cta: 'Go to Dashboard',
  },
];

export default function OnboardingGuide({ onComplete }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function next() {
    if (isLast) {
      onComplete();
    } else {
      setStep(s => s + 1);
    }
  }

  function skip() {
    setStep(s => s + 1);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-5 pb-1">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === step
                  ? 'w-6 h-2 bg-brand-600'
                  : i < step
                  ? 'w-2 h-2 bg-brand-300'
                  : 'w-2 h-2 bg-gray-200'
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-7 py-6">
          <div className="text-center mb-5">
            <div className="text-5xl mb-3">{current.emoji}</div>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{current.title}</h2>
            <p className="text-gray-500 text-sm mt-2 leading-relaxed">{current.subtitle}</p>
          </div>

          {/* Steps list */}
          {current.content && (
            <ol className="space-y-2.5 mb-5">
              {current.content.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="text-sm text-gray-700 leading-snug">{item}</p>
                </li>
              ))}
            </ol>
          )}

          {/* External link */}
          {current.link && (
            <a
              href={current.link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center bg-blue-50 border border-blue-100 text-blue-700 font-semibold text-sm py-3 rounded-xl hover:bg-blue-100 transition-colors mb-4"
            >
              {current.link.label}
            </a>
          )}

          {/* Note */}
          {current.note && (
            <div className="bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-yellow-800 leading-snug">
                <span className="font-semibold">Note: </span>{current.note}
              </p>
            </div>
          )}

          {/* Actions */}
          <button
            onClick={next}
            className="w-full bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 transition-colors text-sm"
          >
            {current.cta}
          </button>

          {current.skip && (
            <button
              onClick={skip}
              className="w-full mt-2 text-gray-400 hover:text-gray-600 text-xs py-2 transition-colors"
            >
              {current.skip}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
