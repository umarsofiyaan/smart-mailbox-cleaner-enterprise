// src/services/tokenService.js
// Manages OAuth token storage (AES encrypted) and JWT refresh token rotation.
//
// Multi-device support: each device gets its own row in refresh_tokens.
// Device A refreshing does NOT invalidate Device B's token.
//
// FIX: rotateRefreshToken now checks deleted_at IS NULL — deleted users
// cannot refresh their session even if they have a valid refresh token.

const { query }   = require('../config/database');
const { encrypt, decrypt, hashToken } = require('../utils/encryption');
const { createAuthenticatedClient }   = require('../config/google');
const { generateAccessToken, generateRefreshToken } = require('../middleware/auth');
const logger = require('../utils/logger');
const { ensurePrimaryMailbox } = require('./mailboxService');

// ─── OAuth tokens (Google) ─────────────────────────────────────────────────

async function storeOAuthTokens(userId, tokens) {
  const encryptedRefresh = encrypt(tokens.refresh_token);
  const tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);
  const encryptedAccess = encrypt(tokens.access_token);
  const scopes = tokens.scope ? tokens.scope.split(' ') : [];

  await query(
    `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_expiry, scopes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
     SET access_token = $2,
         refresh_token = $3,
         token_expiry = $4,
         scopes = $5,
         updated_at = NOW()`,
    [
      userId,
      encryptedAccess,
      encryptedRefresh,
      tokenExpiry,
      scopes,
    ]
  );

  try {
    const userRes = await query(
      `SELECT google_id, email
       FROM users
       WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];
    if (user?.google_id && user?.email) {
      await query(
        `INSERT INTO connected_mailboxes
           (user_id, google_account_id, google_email, access_token, refresh_token, token_expiry, scopes, is_primary, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active')
         ON CONFLICT (user_id, google_account_id) DO UPDATE
           SET google_email = EXCLUDED.google_email,
               access_token = EXCLUDED.access_token,
               refresh_token = EXCLUDED.refresh_token,
               token_expiry = EXCLUDED.token_expiry,
               scopes = EXCLUDED.scopes,
               is_primary = TRUE,
               status = 'active',
               updated_at = NOW()`,
        [userId, user.google_id, user.email.toLowerCase(), encryptedAccess, encryptedRefresh, tokenExpiry, scopes]
      );
      await query(
        `UPDATE connected_mailboxes
         SET is_primary = CASE WHEN google_account_id = $2 THEN TRUE ELSE FALSE END,
             updated_at = NOW()
         WHERE user_id = $1`,
        [userId, user.google_id]
      );
    }
  } catch (err) {
    logger.warn('Failed to sync primary mailbox row from oauth_tokens', { userId, error: err.message });
  }
}

async function getOAuthTokens(userId, mailboxId = null) {
  await ensurePrimaryMailbox(userId);

  let mailboxResult;
  if (mailboxId) {
    mailboxResult = await query(
      `SELECT id, google_email, access_token, refresh_token, token_expiry
       FROM connected_mailboxes
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [mailboxId, userId]
    );
  } else {
    mailboxResult = await query(
      `SELECT id, google_email, access_token, refresh_token, token_expiry
       FROM connected_mailboxes
       WHERE user_id = $1 AND status = 'active'
       ORDER BY is_primary DESC, created_at ASC
       LIMIT 1`,
      [userId]
    );
  }

  if (mailboxResult.rows[0]) {
    const row = mailboxResult.rows[0];
    let accessToken = decrypt(row.access_token);
    const refreshToken = decrypt(row.refresh_token);
    const expiry = new Date(row.token_expiry);

    if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
      logger.info('Mailbox access token expiring, refreshing...', { userId, mailboxId: row.id });
      const newTokens = await refreshAccessToken(userId, refreshToken, row.id);
      accessToken = newTokens.access_token;
    }

    return {
      accessToken,
      refreshToken,
      tokenExpiry: expiry.getTime(),
      mailboxId: row.id,
      mailboxEmail: row.google_email,
    };
  }

  const result = await query(
    `SELECT access_token, refresh_token, token_expiry
     FROM oauth_tokens WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('No OAuth tokens found for user. Please reconnect your Gmail account.');
  }

  const row          = result.rows[0];
  let   accessToken  = decrypt(row.access_token);
  const refreshToken = decrypt(row.refresh_token);
  const expiry       = new Date(row.token_expiry);

  // Refresh if expiring within 5 minutes
  if (expiry.getTime() - Date.now() < 5 * 60 * 1000) {
    logger.info('Access token expiring, refreshing...', { userId });
    const newTokens = await refreshAccessToken(userId, refreshToken);
    accessToken = newTokens.access_token;
  }

  return { accessToken, refreshToken, tokenExpiry: expiry.getTime(), mailboxId: null, mailboxEmail: null };
}

async function refreshAccessToken(userId, refreshToken, mailboxId = null) {
  const client = createAuthenticatedClient('', refreshToken);
  let newTokens;
  try {
    const { credentials } = await client.refreshAccessToken();
    newTokens = credentials;
  } catch (err) {
    logger.error('Failed to refresh Google access token', err, { userId });
    throw new Error('Gmail token refresh failed. Please reconnect your account.');
  }

  const tokenToStore = {
    access_token:  newTokens.access_token,
    refresh_token: newTokens.refresh_token || refreshToken,
    expiry_date:   newTokens.expiry_date,
    scope:         newTokens.scope,
  };

  if (mailboxId) {
    const encryptedAccess = encrypt(tokenToStore.access_token);
    const encryptedRefresh = encrypt(tokenToStore.refresh_token);
    const tokenExpiry = new Date(tokenToStore.expiry_date || Date.now() + 3600 * 1000);
    const scopes = tokenToStore.scope ? tokenToStore.scope.split(' ') : [];

    await query(
      `UPDATE connected_mailboxes
       SET access_token = $2,
           refresh_token = $3,
           token_expiry = $4,
           scopes = $5,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $6`,
      [mailboxId, encryptedAccess, encryptedRefresh, tokenExpiry, scopes, userId]
    );

    const primary = await query(
      `SELECT is_primary
       FROM connected_mailboxes
       WHERE id = $1 AND user_id = $2`,
      [mailboxId, userId]
    );
    if (primary.rows[0]?.is_primary) {
      await query(
        `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_expiry, scopes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET access_token = $2,
               refresh_token = $3,
               token_expiry = $4,
               scopes = $5,
               updated_at = NOW()`,
        [userId, encryptedAccess, encryptedRefresh, tokenExpiry, scopes]
      );
    }
  } else {
    await storeOAuthTokens(userId, tokenToStore);
  }
  return newTokens;
}

// ─── JWT refresh tokens ────────────────────────────────────────────────────

/**
 * Store a new refresh token hash.
 * Each device/session gets its own row — multi-device is supported natively.
 */
async function storeRefreshTokenHash(userId, refreshToken) {
  const hash      = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );

  // Clean up old expired/revoked tokens for this user (housekeeping)
  await query(
    `DELETE FROM refresh_tokens
     WHERE user_id = $1
       AND (is_revoked = TRUE OR expires_at < NOW() - INTERVAL '1 day')`,
    [userId]
  );
}

/**
 * Validate and rotate a JWT refresh token.
 * Issues a new access + refresh token pair.
 *
 * FIX: Now checks that user is not soft-deleted before issuing new tokens.
 * Multi-device: only THIS device's token is rotated; other devices unaffected.
 */
async function rotateRefreshToken(refreshToken) {
  const hash = hashToken(refreshToken);

  const result = await query(
    `SELECT rt.id, rt.user_id, rt.is_revoked, rt.expires_at
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND u.deleted_at IS NULL`,
    [hash]
  );
  // FIX: reject tokens for deleted users

  // Check without deleted_at to give a better error message
  if (result.rows.length === 0) {
    const anyResult = await query(
      `SELECT rt.user_id, u.deleted_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1`,
      [hash]
    );
    if (anyResult.rows[0]?.deleted_at) {
      throw new Error('Account has been deactivated. Please contact support.');
    }
    throw new Error('Session not found. Please log in again.');
  }

  const stored = result.rows[0];

  if (stored.is_revoked) {
    // Token reuse detected — revoke ALL tokens for this user (security measure)
    await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1', [stored.user_id]);
    throw new Error('Session conflict detected. Please log in again on all devices.');
  }

  if (new Date(stored.expires_at) < new Date()) {
    throw new Error('Session expired. Please log in again.');
  }

  // Revoke the used token (rotation — prevents replay attacks)
  await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE id = $1', [stored.id]);

  // Get fresh user data
  const userResult = await query(
    `SELECT id, email FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [stored.user_id]
  );

  if (userResult.rows.length === 0) {
    throw new Error('Account has been deactivated. Please contact support.');
  }

  const user = userResult.rows[0];

  // Issue new pair for THIS device only
  const newAccessToken  = generateAccessToken(user.id, user.email);
  const newRefreshToken = generateRefreshToken(user.id);
  await storeRefreshTokenHash(user.id, newRefreshToken);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, user };
}

/**
 * Revoke ALL sessions for a user.
 * Called by: admin delete, logout, security events.
 */
async function revokeAllTokens(userId) {
  await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1', [userId]);
}

/**
 * Delete all OAuth data for a user (GDPR self-delete).
 */
async function deleteUserTokens(userId) {
  await query('DELETE FROM oauth_tokens    WHERE user_id = $1', [userId]);
  await query('DELETE FROM refresh_tokens  WHERE user_id = $1', [userId]);
}

module.exports = {
  storeOAuthTokens,
  getOAuthTokens,
  refreshAccessToken,
  storeRefreshTokenHash,
  rotateRefreshToken,
  revokeAllTokens,
  deleteUserTokens,
};
