// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

/**
 * Verify JWT access token from Authorization header or HttpOnly cookie.
 * Attaches req.user = { id, email, googleId }
 */
async function requireAuth(req, res, next) {
  try {
    let token = null;

    // 1. Try Authorization: Bearer header (extension, API clients)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }

    // 2. Try HttpOnly cookie (web dashboard)
    if (!token && req.cookies && req.cookies.access_token) {
      token = req.cookies.access_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    // Verify signature and expiry
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Access token expired.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid access token.' });
    }

    // Confirm user still exists
    const result = await query(
      'SELECT id, email, google_id, display_name FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = {
      id: result.rows[0].id,
      email: result.rows[0].email,
      googleId: result.rows[0].google_id,
      displayName: result.rows[0].display_name,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
}

/**
 * Generate a short-lived JWT access token (1 hour)
 */
function generateAccessToken(userId, email) {
  return jwt.sign(
    { userId, email, type: 'access' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h' }
  );
}

/**
 * Generate a long-lived refresh token (30 days)
 */
function generateRefreshToken(userId) {
  return jwt.sign(
    { userId, type: 'refresh', jti: require('crypto').randomBytes(16).toString('hex') },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
}

/**
 * Verify a refresh token
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

module.exports = {
  requireAuth,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
};
