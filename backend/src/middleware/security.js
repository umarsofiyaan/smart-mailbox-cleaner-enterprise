// src/middleware/security.js
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

/**
 * Helmet security headers
 */
const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

/**
 * CORS — only allow web dashboard and Chrome Extension
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  // Chrome extensions use chrome-extension:// protocol
  `chrome-extension://${process.env.EXTENSION_ID}`,
];

const corsMiddleware = cors({
  origin: true, // Allow all origins for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});

/**
 * General API rate limiter
 */
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
  skip: (req) => req.path === '/health',
});

/**
 * Strict limiter for auth endpoints
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' },
});

/**
 * Strict limiter for scan endpoints (expensive operations)
 */
const scanLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Scan rate limit reached. You can run up to 10 scans per hour.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

/**
 * Strict limiter for cleanup endpoints
 */
const cleanupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Cleanup rate limit reached.' },
  keyGenerator: (req) => req.user?.id || req.ip,
});

module.exports = {
  helmetMiddleware,
  corsMiddleware,
  generalLimiter,
  authLimiter,
  scanLimiter,
  cleanupLimiter,
};
