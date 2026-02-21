// src/app.js
// Smart Mailbox Cleaner — Express backend
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');

const { helmetMiddleware, corsMiddleware, generalLimiter } = require('./middleware/security');
const authRoutes = require('./routes/auth');
const scanRoutes = require('./routes/scan');
const cleanupRoutes = require('./routes/cleanup');
const subscriptionRoutes = require('./routes/subscription');
const adminRoutes = require('./routes/admin'); // FIX: was never imported
const { startWorker } = require('./jobs/worker');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security middleware ─────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(generalLimiter);

// ── Stripe webhook MUST use raw body — register BEFORE json parser ─
app.use('/subscription/webhook', subscriptionRoutes);

// ── Standard middleware ─────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ── Logging ─────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: {
      write: (msg) => logger.info(msg.trim()),
    },
    skip: () => false,
  }));
}

// ── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ───────────────────────────────────────────────
app.use('/auth', (req, res, next) => {
  logger.info(`Auth route: ${req.method} ${req.path}`);
  next();
}, authRoutes);
app.use('/scan', scanRoutes);
app.use('/cleanup', cleanupRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/admin', adminRoutes); // FIX: this line was completely missing — caused "No users found"

// ── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ── Global error handler ─────────────────────────────────────
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

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    frontend: process.env.FRONTEND_URL,
  });

  startWorker();
});

// ── Graceful shutdown ─────────────────────────────────────────
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

module.exports = app;
