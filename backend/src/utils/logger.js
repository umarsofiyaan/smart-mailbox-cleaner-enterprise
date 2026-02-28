// src/utils/logger.js
// Production-safe structured logger.
// NEVER logs email content, tokens, or bodies.
// All logger.error() calls are automatically forwarded to Sentry.

const { captureException } = require('../config/sentry');

const SENSITIVE_FIELDS = [
  'body', 'snippet', 'payload', 'raw', 'emailBody',
  'refresh_token', 'access_token', 'password', 'secret',
  'authorization', 'cookie', 'razorpay_signature',
];

function sanitize(obj, depth = 0) {
  if (depth > 5) return '[truncated]';
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 10).map(i => sanitize(i, depth + 1));

  const sanitized = {};
  for (const [key, val] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = sanitize(val, depth + 1);
    }
  }
  return sanitized;
}

const logger = {
  info: (msg, data) => {
    console.log(JSON.stringify({
      level: 'info',
      ts: new Date().toISOString(),
      msg,
      ...(data ? { data: sanitize(data) } : {}),
    }));
  },

  warn: (msg, data) => {
    console.warn(JSON.stringify({
      level: 'warn',
      ts: new Date().toISOString(),
      msg,
      ...(data ? { data: sanitize(data) } : {}),
    }));
  },

  /**
   * Log an error and automatically send it to Sentry.
   *
   * Usage (same API as before — no changes needed in existing code):
   *   logger.error('Scan failed', err, { scanId, userId })
   *
   * @param {string} msg     - Human-readable description
   * @param {Error}  err     - The actual Error object (or string)
   * @param {object} context - Extra key/value pairs for debugging
   */
  error: (msg, err, context = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      msg,
      error: err?.message || String(err),
      stack: err?.stack,
      ...(Object.keys(context).length ? { data: sanitize(context) } : {}),
    }));

    // Forward to Sentry — captureException is a no-op if SENTRY_DSN not set
    captureException(err, { msg, ...sanitize(context) });
  },
};

module.exports = logger;
