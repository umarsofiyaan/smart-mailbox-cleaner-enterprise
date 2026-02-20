// src/utils/logger.js
// Production-safe logger. NEVER logs email content.
const SENSITIVE_FIELDS = [
  'body', 'snippet', 'payload', 'raw', 'emailBody',
  'refresh_token', 'access_token', 'password', 'secret',
  'authorization', 'cookie'
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
  error: (msg, err, data) => {
    console.error(JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      msg,
      error: err?.message,
      ...(data ? { data: sanitize(data) } : {}),
    }));
  },
};

module.exports = logger;
