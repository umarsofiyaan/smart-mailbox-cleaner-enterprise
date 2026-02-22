// src/config/sentry.js
// Sentry error tracking — initialise ONCE, import everywhere via logger.js.
// Safe to import even when SENTRY_DSN is not set (Sentry silently no-ops).

const Sentry = require('@sentry/node');

const SENTRY_DSN = process.env.SENTRY_DSN;
const ENV       = process.env.NODE_ENV || 'development';
const RELEASE   = process.env.npm_package_version || '1.0.0';

/**
 * Call this once at the very top of app.js, before any other require().
 * Sentry must be initialised before routes/middleware are loaded so it
 * can automatically instrument Express, pg, and http requests.
 */
function initSentry() {
  if (!SENTRY_DSN) {
    // No DSN in env → skip silently. Useful during local dev.
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENV,
    release: `smart-mailbox-cleaner@${RELEASE}`,

    // Capture 100% of errors, 10% of transactions (performance tracing).
    // Raise tracesSampleRate to 1.0 during debugging then lower in prod.
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,

    // Integrations auto-instrumented by @sentry/node:
    //   Express, HTTP, PostgreSQL (pg), console
    integrations: [
      // Capture unhandled promise rejections
      new Sentry.Integrations.OnUncaughtException(),
      new Sentry.Integrations.OnUnhandledRejection(),
    ],

    // Strip sensitive data before sending to Sentry.
    // NEVER send email content, tokens, or PII.
    beforeSend(event) {
      // Scrub auth headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-refresh-token'];
      }

      // Scrub request body fields that may contain tokens
      if (event.request?.data) {
        const sensitiveKeys = [
          'access_token', 'refresh_token', 'password',
          'razorpay_signature', 'razorpay_payment_id',
        ];
        for (const key of sensitiveKeys) {
          if (event.request.data[key]) {
            event.request.data[key] = '[REDACTED]';
          }
        }
      }

      return event;
    },
  });
}

/**
 * Express error handler middleware — must be the LAST app.use() call.
 * Captures 4xx and 5xx errors automatically.
 */
function sentryErrorHandler() {
  return Sentry.Handlers.errorHandler();
}

/**
 * Express request handler middleware — must be the FIRST app.use() call.
 * Adds transaction / trace context to every request.
 */
function sentryRequestHandler() {
  return Sentry.Handlers.requestHandler();
}

/**
 * Express tracing middleware — goes after requestHandler.
 */
function sentryTracingHandler() {
  return Sentry.Handlers.tracingHandler();
}

/**
 * Manually capture an exception. Used by logger.error().
 */
function captureException(err, context = {}) {
  if (!SENTRY_DSN) return;
  Sentry.withScope(scope => {
    for (const [key, val] of Object.entries(context)) {
      scope.setExtra(key, val);
    }
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/**
 * Set the authenticated user on the current Sentry scope.
 * Call this after JWT verification in auth middleware.
 */
function setSentryUser(userId, email) {
  if (!SENTRY_DSN) return;
  Sentry.setUser({ id: userId, email });
}

/**
 * Clear user context (on logout / unauthenticated routes).
 */
function clearSentryUser() {
  if (!SENTRY_DSN) return;
  Sentry.setUser(null);
}

module.exports = {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
  captureException,
  setSentryUser,
  clearSentryUser,
};
