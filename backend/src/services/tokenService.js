// src/services/tokenService.js
// Manages OAuth token storage with AES encryption + refresh rotation
const { query } = require('../config/database');
const { encrypt, decrypt, hashToken } = require('../utils/encryption');
const { createAuthenticatedClient } = require('../config/google');
const { generateAccessToken, generateRefreshToken } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Store OAuth tokens for a user.
 * Refresh token is AES-256 encrypted before storage.
 */
async function storeOAuthTokens(userId, tokens) {
  const encryptedRefresh = encrypt(tokens.refresh_token);
  const tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

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
      encrypt(tokens.access_token),
      encryptedRefresh,
      tokenExpiry,
      tokens.scope ? tokens.scope.split(' ') : [],
    ]
  );
}

/**
 * Retrieve and decrypt OAuth tokens for a user.
 * Automatically refreshes if access token is expired.
 */
async function getOAuthTokens(userId) {
  const result = await query(
    `SELECT access_token, refresh_token, token_expiry
     FROM oauth_tokens WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('No OAuth tokens found for user. Please reconnect your Gmail account.');
  }

  const row = result.rows[0];
  let accessToken = decrypt(row.access_token);
  const refreshToken = decrypt(row.refresh_token);
  const expiry = new Date(row.token_expiry);

  // Refresh if expired or expiring within 5 minutes
  const fiveMinutes = 5 * 60 * 1000;
  if (expiry.getTime() - Date.now() < fiveMinutes) {
    logger.info('Access token expiring, refreshing...', { userId });
    const newTokens = await refreshAccessToken(userId, refreshToken);
    accessToken = newTokens.access_token;
  }

  return { accessToken, refreshToken };
}

/**
 * Refresh an access token using the stored refresh token.
 */
async function refreshAccessToken(userId, refreshToken) {
  const client = createAuthenticatedClient('', refreshToken);

  let newTokens;
  try {
    const { credentials } = await client.refreshAccessToken();
    newTokens = credentials;
  } catch (err) {
    logger.error('Failed to refresh Google access token', err, { userId });
    throw new Error('Gmail token refresh failed. Please reconnect your account.');
  }

  // If Google rotated the refresh token, store the new one
  const tokenToStore = {
    access_token: newTokens.access_token,
    refresh_token: newTokens.refresh_token || refreshToken,
    expiry_date: newTokens.expiry_date,
    scope: newTokens.scope,
  };

  await storeOAuthTokens(userId, tokenToStore);
  return newTokens;
}

/**
 * Store a JWT refresh token hash in the DB for rotation tracking.
 */
async function storeRefreshTokenHash(userId, refreshToken) {
  const hash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );
}

/**
 * Validate and rotate a JWT refresh token.
 * Returns new access + refresh token pair.
 */
async function rotateRefreshToken(refreshToken) {
  const hash = hashToken(refreshToken);

  const result = await query(
    `SELECT id, user_id, is_revoked, expires_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [hash]
  );

  if (result.rows.length === 0) {
    throw new Error('Refresh token not found.');
  }

  const stored = result.rows[0];

  if (stored.is_revoked) {
    // Token reuse detected — revoke all tokens for this user (security)
    await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1', [stored.user_id]);
    throw new Error('Refresh token reuse detected. All sessions revoked.');
  }

  if (new Date(stored.expires_at) < new Date()) {
    throw new Error('Refresh token expired. Please log in again.');
  }

  // Revoke used token
  await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE id = $1', [stored.id]);

  // Get user info
  const userResult = await query('SELECT id, email FROM users WHERE id = $1', [stored.user_id]);
  const user = userResult.rows[0];

  // Issue new pair
  const newAccessToken = generateAccessToken(user.id, user.email);
  const newRefreshToken = generateRefreshToken(user.id);
  await storeRefreshTokenHash(user.id, newRefreshToken);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken, user };
}

/**
 * Revoke all refresh tokens for a user (logout)
 */
async function revokeAllTokens(userId) {
  await query('UPDATE refresh_tokens SET is_revoked = TRUE WHERE user_id = $1', [userId]);
}

/**
 * Delete all OAuth data for a user (GDPR)
 */
async function deleteUserTokens(userId) {
  await query('DELETE FROM oauth_tokens WHERE user_id = $1', [userId]);
  await query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
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
