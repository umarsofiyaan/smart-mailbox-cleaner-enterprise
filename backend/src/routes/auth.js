// src/routes/auth.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const { getAuthUrl, exchangeCode, getGoogleProfile } = require('../config/google');
const { query } = require('../config/database');
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  requireAuth,
} = require('../middleware/auth');
const {
  storeOAuthTokens,
  storeRefreshTokenHash,
  rotateRefreshToken,
  revokeAllTokens,
  deleteUserTokens,
} = require('../services/tokenService');
const { authLimiter } = require('../middleware/security');
const logger = require('../utils/logger');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000, // 15 minutes (access token lifetime)
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/auth/refresh',
};

/**
 * GET /auth/google
 * Initiate OAuth flow. Returns redirect URL.
 * Accepts optional `state` query param (used by extension).
 */
router.get('/google', authLimiter, (req, res) => {
  const state = req.query.state || '';
  const authUrl = getAuthUrl(state);
  res.json({ url: authUrl });
});

/**
 * GET /auth/google/callback
 * OAuth2 callback from Google. Exchanges code for tokens, creates/updates user.
 */
router.get('/google/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.warn('Google OAuth error returned', { error });
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_denied`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode(code);

    if (!tokens.refresh_token) {
      // User has already authorized — prompt re-consent
      return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_refresh_token&hint=revoke_access`);
    }

    // Get user profile
    const profile = await getGoogleProfile(tokens.access_token);

    // Upsert user
    const userResult = await query(
      `INSERT INTO users (google_id, email, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
       SET email = $2, display_name = $3, avatar_url = $4, updated_at = NOW()
       RETURNING id, email, display_name`,
      [profile.id, profile.email, profile.name, profile.picture]
    );

    const user = userResult.rows[0];

    // Initialize subscription record if not exists
    await query(
      `INSERT INTO subscription_status (user_id, plan, status)
       VALUES ($1, 'free', 'active')
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    // Store encrypted OAuth tokens
    await storeOAuthTokens(user.id, tokens);

    // Issue JWT pair
    const accessToken = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await storeRefreshTokenHash(user.id, refreshToken);

    // Detect if this is an extension callback (state param)
    if (state === 'extension') {
      // Redirect to extension with tokens in URL fragment (extension reads and clears them)
      return res.redirect(
        `${process.env.FRONTEND_URL}/extension-auth?access_token=${accessToken}&refresh_token=${refreshToken}`
      );
    }

    // Web dashboard — redirect with tokens in URL fragment
    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?access_token=${accessToken}&refresh_token=${refreshToken}`
    );

  } catch (err) {
    logger.error('OAuth callback failed', err);
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

/**
 * POST /auth/refresh
 * Rotate refresh token and issue new access token.
 * Reads refresh token from HttpOnly cookie or request body (for extension).
 */
router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required.' });
    }

    // Verify JWT structure first
    try {
      verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid refresh token.', code: 'REFRESH_INVALID' });
    }

    const { accessToken, refreshToken: newRefreshToken, user } = await rotateRefreshToken(refreshToken);

    // Set new cookies for web dashboard
    res.cookie('access_token', accessToken, COOKIE_OPTIONS);
    res.cookie('refresh_token', newRefreshToken, REFRESH_COOKIE_OPTIONS);

    // Also return in body for extension clients
    return res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email },
    });

  } catch (err) {
    logger.warn('Token refresh failed', { error: err.message });
    return res.status(401).json({ error: err.message, code: 'REFRESH_FAILED' });
  }
});

/**
 * POST /auth/logout
 * Revoke all refresh tokens and clear cookies.
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await revokeAllTokens(req.user.id);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/auth/refresh' });

    return res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    logger.error('Logout failed', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Logout failed.' });
  }
});

/**
 * GET /auth/me
 * Return current authenticated user info.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at,
              s.plan, s.status as subscription_status, s.current_period_end
       FROM users u
       LEFT JOIN subscription_status s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = result.rows[0];
    return res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      joinedAt: user.created_at,
      subscription: {
        plan: user.plan || 'free',
        status: user.subscription_status || 'active',
        isPro: user.plan === 'pro' && user.subscription_status === 'active',
        currentPeriodEnd: user.current_period_end,
      },
    });
  } catch (err) {
    logger.error('GET /auth/me failed', err);
    return res.status(500).json({ error: 'Failed to fetch user info.' });
  }
});

/**
 * DELETE /auth/account
 * GDPR: Delete all user data permanently.
 */
router.delete('/account', requireAuth, async (req, res) => {
  const userId = req.user.id;

  try {
    await deleteUserTokens(userId);

    // Delete user (cascades to all related tables via FK)
    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/auth/refresh' });

    logger.info('User account deleted (GDPR)', { userId });
    return res.json({ success: true, message: 'Your account and all data have been permanently deleted.' });

  } catch (err) {
    logger.error('Account deletion failed', err, { userId });
    return res.status(500).json({ error: 'Account deletion failed.' });
  }
});

module.exports = router;
