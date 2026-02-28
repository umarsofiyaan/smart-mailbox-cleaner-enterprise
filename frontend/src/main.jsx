// src/main.jsx
// Sentry must be initialised before React renders so it can
// catch errors in components, hooks, and async boundaries.

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import './index.css';
import App from './App';

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
const ENV        = import.meta.env.MODE; // 'development' | 'production'

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    release: `smart-mailbox-cleaner-frontend@${import.meta.env.VITE_APP_VERSION || '1.0.0'}`,

    integrations: [
      // Tracks React component render performance + errors
      new Sentry.BrowserTracing(),
      // Captures React render errors (works with ErrorBoundary below)
      new Sentry.Replay({
        // Only record sessions that have an error — saves quota
        maskAllText: true,         // mask all text for privacy
        blockAllMedia: true,       // don't capture screenshots of emails
        sessionSampleRate: 0,      // don't record normal sessions
        errorSampleRate: 1.0,      // record 100% of sessions with errors
      }),
    ],

    // Capture 100% of errors, 5% of page-load transactions
    tracesSampleRate: ENV === 'production' ? 0.05 : 1.0,

    // Never send email content or tokens to Sentry
    beforeSend(event) {
      // Scrub any URL params that might contain tokens
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          ['access_token', 'refresh_token', 'token', 'code'].forEach(p => {
            if (url.searchParams.has(p)) url.searchParams.set(p, '[REDACTED]');
          });
          event.request.url = url.toString();
        } catch {}
      }
      return event;
    },
  });
}

// Wrap the whole app in Sentry's ErrorBoundary so unhandled React
// render errors are caught, reported, and shown a fallback UI.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f9fafb',
        }}>
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <p style={{ fontSize: '2rem', marginBottom: '1rem' }}>😕</p>
            <h2 style={{ fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              The error has been reported. Please refresh and try again.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#4F46E5',
                color: 'white',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.625rem 1.5rem',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Refresh page
            </button>
          </div>
        </div>
      }
      showDialog={false}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
