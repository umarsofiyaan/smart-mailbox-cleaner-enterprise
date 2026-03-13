// src/app.js
// Smart Mailbox Cleaner — Express backend
//
// Sentry MUST be initialised before any other require() so it can
// auto-instrument Express, pg, and http. initSentry() is called at
// the very top, before routes are loaded.

require('dotenv').config();

// ── Sentry — init first ───────────────────────────────────────────────────────
const {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
} = require('./config/sentry');
initSentry();

// ── Everything else ───────────────────────────────────────────────────────────
const express     = require('express');
const cookieParser = require('cookie-parser');
const morgan      = require('morgan');

const { helmetMiddleware, corsMiddleware, generalLimiter } = require('./middleware/security');
const authRoutes         = require('./routes/auth');
const scanRoutes         = require('./routes/scan');
const cleanupRoutes      = require('./routes/cleanup');
const subscriptionRoutes = require('./routes/subscription');
const adminRoutes        = require('./routes/admin');
const automationRoutes   = require('./routes/automation');
const userRoutes         = require('./routes/user');
const contactRoutes      = require('./routes/contact');
const { startWorker }    = require('./jobs/worker');
const logger             = require('./utils/logger');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Sentry request / tracing handlers (must be FIRST middleware) ─────────────
app.use(sentryRequestHandler());
app.use(sentryTracingHandler());

// ── Security middleware ───────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(generalLimiter);

// ── Stripe/Razorpay webhook — raw body MUST come before json parser ──────────
// Only the webhook endpoint needs express.raw(). Mounting the whole subscriptionRoutes
// here caused all other /subscription/* routes to also run before json() was set up.
// Instead, mount ONLY the raw webhook handler on the exact path.
app.post(
  '/subscription/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const { handleWebhook } = require('./services/stripeService');
    const signature = req.headers['x-razorpay-signature'];
    if (!signature) return res.status(400).json({ error: 'Missing Razorpay signature.' });
    try {
      await handleWebhook(req.body, signature);
      return res.json({ received: true });
    } catch (err) {
      logger.error('Webhook processing failed', err);
      return res.status(400).json({ error: err.message });
    }
  }
);

// ── Standard middleware ───────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ── Request logging ───────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) },
    skip: () => false,
  }));
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'smart-mailbox-cleaner-api',
    status: 'ok',
    health: '/health',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/auth', (req, res, next) => {
  logger.info(`Auth route: ${req.method} ${req.path}`);
  next();
}, authRoutes);
app.use('/scan',         scanRoutes);
app.use('/cleanup',      cleanupRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/admin',        adminRoutes);
app.use('/automation',   automationRoutes);
app.use('/user',         userRoutes);
app.use('/contact',      contactRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ── Sentry error handler (must be BEFORE the generic error handler) ──────────
app.use(sentryErrorHandler());

// ── Generic error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS policy')) {
    return res.status(403).json({ error: 'CORS: Origin not allowed.' });
  }

  logger.error('Unhandled error', err, {
    path: req.path,
    method: req.method,
  });

  return res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred.'
      : err.message,
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    frontend: process.env.FRONTEND_URL,
    sentry: !!process.env.SENTRY_DSN,
  });
  startWorker();
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error(
    'Unhandled Promise Rejection',
    reason instanceof Error ? reason : new Error(String(reason))
  );
});

module.exports = app;
