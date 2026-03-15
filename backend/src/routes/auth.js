// src/routes/auth.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const router = express.Router();

const { getAuthUrl, exchangeCode, getGoogleProfile, createPkcePair } = require('../config/google');
const { query, getClient } = require('../config/database');
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
  getOAuthTokens,
} = require('../services/tokenService');
const { upsertConnectedMailbox } = require('../services/mailboxService');
const { grantDailyQuotaOnLogin } = require('../services/quotaService');
const { sendWelcomeEmail } = require('../services/emailService');
const { authLimiter } = require('../middleware/security');
const { encrypt, decrypt, hashToken } = require('../utils/encryption');
const logger = require('../utils/logger');

const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.JWT_ACCESS_SECRET;
if (!OAUTH_STATE_SECRET) {
  throw new Error('OAUTH_STATE_SECRET (or JWT_ACCESS_SECRET) must be set.');
}

const EXTENSION_CODE_TTL_MS = 2 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 60 * 60 * 1000, // 1 hour
};

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/auth/refresh',
};

const OAUTH_STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/auth/google/callback',
};

const OAUTH_CONNECT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000,
  path: '/auth/google/callback',
};


const OAUTH_PKCE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000,
  path: '/auth/google/callback',
};

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

function createOAuthState(mode, nonce, userId = null) {
  const payload = {
    mode,
    nonce,
    userId,
    iat: Date.now(),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOAuthState(stateToken, expectedNonce) {
  if (!stateToken || !expectedNonce || !stateToken.includes('.')) return { ok: false };

  const [encoded, providedSig] = stateToken.split('.');
  if (!encoded || !providedSig) return { ok: false };

  const expectedSig = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encoded).digest('base64url');

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

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

async function storePendingExtensionSession({ accessToken, refreshToken, userId }) {
  const code = crypto.randomBytes(32).toString('hex');
  const codeHash = hashToken(code);
  await query('DELETE FROM extension_exchange_codes WHERE expires_at <= NOW()', []);
  await query(
    `INSERT INTO extension_exchange_codes (code_hash, access_token, refresh_token, user_id, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' milliseconds')::interval)`,
    [codeHash, encrypt(accessToken), encrypt(refreshToken), userId, String(EXTENSION_CODE_TTL_MS)]
  );
  return code;
}

async function consumePendingExtensionSession(code) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM extension_exchange_codes WHERE expires_at <= NOW()');

    const codeHash = hashToken(code);
    const result = await client.query(
      `DELETE FROM extension_exchange_codes
       WHERE code_hash = $1 AND expires_at > NOW()
       RETURNING access_token, refresh_token`,
      [codeHash]
    );

    await client.query('COMMIT');

    const row = result.rows[0];
    if (!row) return null;

    return {
      accessToken: decrypt(row.access_token),
      refreshToken: decrypt(row.refresh_token),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── GET /auth/google ─────────────────────────────────────────────────────────
// Initiate OAuth flow. Returns Google redirect URL.
// ?force=true  → forces the consent screen (get fresh refresh_token)
// ?state=ext   → extension flow

router.get('/google', authLimiter, (req, res) => {
  const requestedState = req.query.state || '';
  const mode = requestedState === 'extension' ? 'extension' : 'web';
  const scopeBundle = req.query.scope === 'storage' ? 'storage' : 'core';
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = createOAuthState(mode, nonce);
  const forceConsent = req.query.force === 'true';
  const { codeVerifier, codeChallenge } = createPkcePair();
  const authUrl = getAuthUrl(state, {
    forceConsent,
    scopeBundle,
    codeChallenge,
  });
  res.cookie('oauth_state_nonce', nonce, OAUTH_STATE_COOKIE_OPTIONS);
  res.cookie('oauth_pkce_verifier', codeVerifier, OAUTH_PKCE_COOKIE_OPTIONS);
  res.json({ url: authUrl });
});

router.get('/google/connect', requireAuth, authLimiter, async (req, res) => {
  try {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = createOAuthState('connect', nonce, req.user.id);
    const { codeVerifier, codeChallenge } = createPkcePair();
    const authUrl = getAuthUrl(state, {
      forceConsent: true,
      scopeBundle: 'storage',
      codeChallenge,
    });
    res.cookie('oauth_state_nonce', nonce, OAUTH_STATE_COOKIE_OPTIONS);
    res.cookie('oauth_connect_user', req.user.id, OAUTH_CONNECT_COOKIE_OPTIONS);
    res.cookie('oauth_pkce_verifier', codeVerifier, OAUTH_PKCE_COOKIE_OPTIONS);
    return res.json({ url: authUrl });
  } catch (err) {
    logger.error('Failed to create connect mailbox URL', err, { userId: req.user.id });
    return res.status(500).json({ error: 'Failed to start mailbox connection.' });
  }
});

// ─── GET /auth/google/callback ────────────────────────────────────────────────
// OAuth2 callback. Exchanges code for tokens, creates/restores user.

router.get('/google/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query;
  const stateNonce = req.cookies?.oauth_state_nonce;
  const connectCookieUserId = req.cookies?.oauth_connect_user;
  const pkceVerifier = req.cookies?.oauth_pkce_verifier;
  res.clearCookie('oauth_state_nonce', { path: '/auth/google/callback' });
  res.clearCookie('oauth_connect_user', { path: '/auth/google/callback' });
  res.clearCookie('oauth_pkce_verifier', { path: '/auth/google/callback' });

  if (error) {
    logger.warn('Google OAuth error returned', { error });
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=oauth_denied`);
  }

  if (!code) {
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
  }

  if (!pkceVerifier) {
    logger.warn('Missing PKCE verifier in OAuth callback');
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
  }

  const verified = verifyOAuthState(state, stateNonce);
  if (!verified.ok) {
    logger.warn('Invalid OAuth state detected', { hasState: !!state, hasNonce: !!stateNonce });
    return res.redirect(`${process.env.FRONTEND_URL}/login?error=invalid_state`);
  }
  const oauthMode = verified.payload.mode === 'extension' ? 'extension' : 'web';
  const isConnectMode = verified.payload.mode === 'connect';

  try {
    const tokens  = await exchangeCode(code, pkceVerifier);
    const profile = await getGoogleProfile(tokens.access_token);

    if (isConnectMode) {
      if (!connectCookieUserId || connectCookieUserId !== verified.payload.userId) {
        logger.warn('Mailbox connect callback failed connect user check', {
          hasCookie: !!connectCookieUserId,
          hasStateUser: !!verified.payload.userId,
        });
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard?mailbox_connected=error`);
      }
      if (!tokens.refresh_token) {
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard?mailbox_connected=consent_required`);
      }

      try {
        await upsertConnectedMailbox(connectCookieUserId, profile, tokens, {
          actorUserId: connectCookieUserId,
          actorRole: 'user',
        });
        return res.redirect(
          `${process.env.FRONTEND_URL}/dashboard?mailbox_connected=success&mailbox_email=${encodeURIComponent(profile.email || '')}`
        );
      } catch (connectErr) {
        logger.error('Mailbox connection failed', connectErr, {
          userId: connectCookieUserId,
          email: profile.email,
        });
        if (String(connectErr.message || '').startsWith('MAILBOX_LIMIT_REACHED')) {
          return res.redirect(`${process.env.FRONTEND_URL}/dashboard?mailbox_connected=limit`);
        }
        return res.redirect(`${process.env.FRONTEND_URL}/dashboard?mailbox_connected=error`);
      }
    }

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

    // Ensure truly new independent signups always begin with fresh free credits.
    if (isNewUser) {
      await query(
        `UPDATE users
         SET delete_credits = 1000,
             free_plan_used = FALSE,
             plan_type = 'free',
             plan_expiry = NULL,
             emails_deleted_total = 0,
             storage_recovered_mb = 0,
             updated_at = NOW()
         WHERE id = $1`,
        [user.id]
      );
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

    res.cookie('access_token', accessToken, COOKIE_OPTIONS);
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

    if (oauthMode === 'extension') {
      const extensionCode = await storePendingExtensionSession({ accessToken, refreshToken, userId: user.id });
      return res.redirect(
        `${process.env.FRONTEND_URL}/extension-auth?code=${extensionCode}`
      );
    }

    return res.redirect(
      `${process.env.FRONTEND_URL}/dashboard?new_user=${isNewUser}`
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

router.post(
  '/extension/exchange',
  authLimiter,
  [body('code').isString().isLength({ min: 32, max: 128 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Invalid exchange code.' });
    }

    const pending = await consumePendingExtensionSession(req.body.code);
    if (!pending) {
      return res.status(400).json({ error: 'Exchange code is invalid or expired.' });
    }

    return res.json({
      accessToken: pending.accessToken,
      refreshToken: pending.refreshToken,
    });
  }
);

// ─── GET /auth/me ─────────────────────────────────────────────────────────────
// Return current authenticated user.
// FIX: deleted_at IS NULL check already enforced by requireAuth middleware.

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, u.display_name, u.avatar_url, u.created_at, u.is_admin,
              u.delete_credits, u.plan_type, u.plan_expiry, u.emails_deleted_total,
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
    const isPowerActive = user.plan_type === 'power' && user.plan_expiry && new Date(user.plan_expiry) > new Date();
    const isPaidPlan = isPowerActive || ['starter', 'pro'].includes(user.plan_type);
    return res.json({
      id:          user.id,
      email:       user.email,
      displayName: user.display_name,
      avatarUrl:   user.avatar_url,
      joinedAt:    user.created_at,
      isAdmin:     user.is_admin || false,
      subscription: {
        plan:            user.plan_type || user.plan || 'free',
        status:          user.subscription_status || 'active',
        isPro:           !!isPaidPlan,
        currentPeriodEnd: user.current_period_end,
      },
      quota: {
        deleteCredits: Number(user.delete_credits || 0),
        planType: user.plan_type || 'free',
        planExpiry: user.plan_expiry || null,
        emailsDeletedTotal: Number(user.emails_deleted_total || 0),
        isPowerActive: !!isPowerActive,
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
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_user_id, target_email, detail, ip_address)
       VALUES (NULL, $1, 'self_delete_account', $2, $1, $3, $4)`,
      [req.user.email || null, userId, JSON.stringify({ initiatedBy: 'user' }), getRequestIp(req)]
    );
    await client.query(
      `DELETE FROM message_original_labels
       WHERE action_id IN (SELECT id FROM cleanup_actions WHERE user_id = $1)`,
      [userId]
    );
    await client.query('DELETE FROM cleanup_actions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM scans WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM mailbox_link_events WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM connected_mailboxes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM playbook_runs WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM playbooks WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM subscription_status WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_quota WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM oauth_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM extension_exchange_codes WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
    await client.query('COMMIT');
    res.clearCookie('access_token');
    res.clearCookie('refresh_token', { path: '/auth/refresh' });
    logger.info('User account self-deleted (GDPR)', { userId });
    return res.json({ success: true, message: 'Your account and all data have been permanently deleted.' });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Account deletion failed', err, { userId });
    return res.status(500).json({ error: 'Account deletion failed.' });
  } finally {
    client.release();
  }
});

module.exports = router;
