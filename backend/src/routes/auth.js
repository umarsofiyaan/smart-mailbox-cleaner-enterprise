// src/routes/auth.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
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
  getOAuthTokens,
} = require('../services/tokenService');
const { grantDailyQuotaOnLogin } = require('../services/quotaService');
const { sendWelcomeEmail } = require('../services/emailService');
const { authLimiter } = require('../middleware/security');
const logger = require('../utils/logger');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  maxAge: 60 * 60 * 1000, // 1 hour
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/auth/refresh',
};

const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'none',
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/auth/google/callback',
};

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function createOAuthState(mode, nonce) {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_ACCESS_SECRET || 'fallback_state_secret';
  const payload = {
    mode,
    nonce,
    iat: Date.now(),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOAuthState(stateToken, expectedNonce) {
  if (!stateToken || !expectedNonce || !stateToken.includes('.')) return { ok: false };

  const [encoded, providedSig] = stateToken.split('.');
  if (!encoded || !providedSig) return { ok: false };

  const secret = process.env.OAUTH_STATE_SECRET || process.env.JWT_ACCESS_SECRET || 'fallback_state_secret';
  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

  // timing-safe compare
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    const ageMs = Date.now() - Number(payload.iat || 0);
    if (!payload?.nonce || !payload?.mode || payload.nonce !== expectedNonce) return { ok: false };
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 10 * 60 * 1000) return { ok: false };
    return { ok: true, payload };
  } catch {
    return { ok: false };
  }
}

// ─── GET /auth/google ─────────────────────────────────────────────────────────
// Initiate OAuth flow. Returns Google redirect URL.
// ?force=true  → forces the consent screen (get fresh refresh_token)
// ?state=ext   → extension flow

router.get('/google', authLimiter, (req, res) => {
  const requestedState = req.query.state || '';
  const mode = requestedState === 'extension' ? 'extension' : 'web';
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = createOAuthState(mode, nonce);
  const forceConsent = req.query.force === 'true';
  const authUrl      = getAuthUrl(state, forceConsent);
  res.cookie('oauth_state_nonce', nonce, OAUTH_STATE_COOKIE_OPTIONS);
  res.json({ url: authUrl });
});

// ─── GET /auth/google/callback ────────────────────────────────────────────────
// OAuth2 callback. Exchanges code for tokens, creates/restores user.

router.get('/google/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query;
  const stateNonce = req.cookies?.oauth_state_nonce;
  res.clearCookie('oauth_state_nonce', { path: '/auth/google/callback' });

  if (error) {
    logger.warn('Google OAuth error returned', { error });
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_denied`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
  }

  const verified = verifyOAuthState(state, stateNonce);
  if (!verified.ok) {
    logger.warn('Invalid OAuth state detected', { hasState: !!state, hasNonce: !!stateNonce });
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
  }
  const oauthMode = verified.payload.mode === 'extension' ? 'extension' : 'web';

  try {
    const tokens  = await exchangeCode(code);
    const profile = await getGoogleProfile(tokens.access_token);

    // ── Find existing user (including soft-deleted) ───────────────────────
    // We check ALL users (not just active) so we can detect and handle
    // the case where a deleted user tries to log back in.
    const existingUser = await query(
      `SELECT id, deleted_at FROM users WHERE google_id = $1`,
      [profile.id]
    );

    const userRecord     = existingUser.rows[0] || null;
    const isDeletedUser  = userRecord && userRecord.deleted_at !== null;
    const isExistingUser = userRecord && !isDeletedUser;

    // ── Handle missing refresh_token ──────────────────────────────────────
    // Google only sends refresh_token on first consent or forced re-consent.
    // If we don't have one from Google, try to fall back to stored token.
    if (!tokens.refresh_token) {
      if (isExistingUser) {
        // Normal returning user — reuse stored token
        try {
          const stored = await getOAuthTokens(userRecord.id);
          tokens.refresh_token = stored.refreshToken;
        } catch {
          // Stored token missing — force consent to get a fresh one
          logger.warn('No stored refresh token for existing user, forcing consent', { userId: userRecord.id });
          return res.redirect(`${process.env.FRONTEND_URL}/login?force_consent=true`);
        }
      } else {
        // Deleted user OR brand-new user with no refresh_token.
        // Google won't send one unless we re-ask for consent.
        logger.warn('No refresh token for new/deleted user, forcing consent');
        return res.redirect(`${process.env.FRONTEND_URL}/login?force_consent=true`);
      }
    }

    // ── Restore soft-deleted user OR upsert normally ──────────────────────
    // If the user was soft-deleted, clear deleted_at so they can use the app again.
    // Admin can re-delete them from the admin panel if needed.
    const userResult = await query(
      `INSERT INTO users (google_id, email, display_name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_id) DO UPDATE
       SET email        = $2,
           display_name = $3,
           avatar_url   = $4,
           deleted_at   = NULL,           -- clear soft-delete on re-login
           deleted_by   = NULL,
           updated_at   = NOW()
       RETURNING id, email, display_name, (xmax = 0) AS is_new_user`,
      [profile.id, profile.email, profile.name, profile.picture]
    );

    const user      = userResult.rows[0];
    const isNewUser = user.is_new_user === true || user.is_new_user === 'true';

    // If this was a deleted user who just came back — log it
    if (isDeletedUser) {
      logger.info('Previously deleted user re-registered', { userId: user.id, email: user.email });
    }

    // Init subscription
    await query(
      `INSERT INTO subscription_status (user_id, plan, status)
       VALUES ($1, 'free', 'active')
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    // Store encrypted OAuth tokens
    await storeOAuthTokens(user.id, tokens);

    // Grant daily quota
    await grantDailyQuotaOnLogin(user.id);

    // Send welcome email for brand-new signups (fire-and-forget)
    if (isNewUser) {
      sendWelcomeEmail(user.email, user.display_name);
    }

    // Issue JWT pair
    const accessToken  = generateAccessToken(user.id, user.email);
    const refreshToken = generateRefreshToken(user.id);
    await storeRefreshTokenHash(user.id, refreshToken);

    if (oauthMode === 'extension') {
      return res.redirect(
        `${process.env.FRONTEND_URL}/extension-auth?access_token=${accessToken}&refresh_token=${refreshToken}`
      );
    }

    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?access_token=${accessToken}&refresh_token=${refreshToken}&new_user=${isNewUser}`
    );

  } catch (err) {
    logger.error('OAuth callback failed', err);
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

// ─── POST /auth/refresh ───────────────────────────────────────────────────────
// Rotate refresh token and issue new access token.
// FIX: rotateRefreshToken now checks deleted_at — deleted users get rejected here.

router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required.' });
    }

    try {
      verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid refresh token.', code: 'REFRESH_INVALID' });
    }

    const { accessToken, refreshToken: newRefreshToken, user } = await rotateRefreshToken(refreshToken);

    await grantDailyQuotaOnLogin(user.id);

    res.cookie('access_token',  accessToken,     COOKIE_OPTIONS);
    res.cookie('refresh_token', newRefreshToken, REFRESH_COOKIE_OPTIONS);

    return res.json({
      accessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email },
    });

  } catch (err) {
    logger.warn('Token refresh failed', { error: err.message });
    const code = err.message.includes('deactivated') ? 'ACCOUNT_DELETED' : 'REFRESH_FAILED';
    return res.status(401).json({ error: err.message, code });
  }
});

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
// Return current authenticated user.
// FIX: deleted_at IS NULL check already enforced by requireAuth middleware.

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin,
              s.plan, s.status as subscription_status, s.current_period_end
       FROM users u
       LEFT JOIN subscription_status s ON s.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Account not found or has been deactivated.', code: 'ACCOUNT_DELETED' });
    }

    const user = result.rows[0];
    return res.json({
      id:          user.id,
      email:       user.email,
      displayName: user.display_name,
      avatarUrl:   user.avatar_url,
      joinedAt:    user.created_at,
      isAdmin:     user.is_admin || false,
      subscription: {
        plan:            user.plan || 'free',
        status:          user.subscription_status || 'active',
        isPro:           user.plan === 'pro' && user.subscription_status === 'active',
        currentPeriodEnd: user.current_period_end,
      },
    });
  } catch (err) {
    logger.error('GET /auth/me failed', err);
    return res.status(500).json({ error: 'Failed to fetch user info.' });
  }
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────

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

// ─── DELETE /auth/account ─────────────────────────────────────────────────────
// GDPR self-delete.

router.delete('/account', requireAuth, async (req, res) => {
  const userId = req.user.id;
  try {
    await deleteUserTokens(userId);
    await query('DELETE FROM users WHERE id = $1', [userId]);
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/auth/refresh' });
    logger.info('User account self-deleted (GDPR)', { userId });
    return res.json({ success: true, message: 'Your account and all data have been permanently deleted.' });
  } catch (err) {
    logger.error('Account deletion failed', err, { userId });
    return res.status(500).json({ error: 'Account deletion failed.' });
  }
});

module.exports = router;
