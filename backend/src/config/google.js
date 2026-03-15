// src/config/google.js
require('dotenv').config();
const crypto = require('crypto');
const { google } = require('googleapis');

const BASE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const CLEANUP_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
];

const STORAGE_SCOPES = [
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

const SCOPES = [
  ...BASE_SCOPES,
  ...CLEANUP_SCOPES,
  ...STORAGE_SCOPES,
];

const SCOPE_BUNDLES = {
  core: [...BASE_SCOPES, ...CLEANUP_SCOPES],
  storage: [...BASE_SCOPES, ...CLEANUP_SCOPES, ...STORAGE_SCOPES],
  full: [...SCOPES],
};

/**
 * Create a new OAuth2 client (unauthenticated)
 */
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function resolveScopes(scopeBundle = 'core') {
  return SCOPE_BUNDLES[scopeBundle] || SCOPE_BUNDLES.core;
}

function createPkcePair() {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Generate the Google OAuth2 consent URL.
 * forceConsent=true only when we know we need a fresh refresh token.
 */
function getAuthUrl(state, {
  forceConsent = false,
  loginHint = '',
  scopeBundle = 'core',
  codeChallenge,
} = {}) {
  if (!state) throw new Error('OAuth state is required.');
  if (!codeChallenge) throw new Error('PKCE code challenge is required.');

  const client = createOAuthClient();
  const params = {
    access_type: 'offline',
    scope: resolveScopes(scopeBundle),
    // Only force consent screen when explicitly needed (e.g. first login or revoked access).
    ...(forceConsent ? { prompt: 'consent select_account' } : { prompt: 'select_account' }),
    state,
    include_granted_scopes: true,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    enable_granular_consent: true,
  };
  if (loginHint) params.login_hint = loginHint;
  return client.generateAuthUrl(params);
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(code, codeVerifier) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken({ code, codeVerifier });
  return tokens;
}

/**
 * Create an authenticated OAuth2 client from stored tokens.
 * tokenExpiry (Unix ms) lets the library auto-refresh before the token expires.
 */
function createAuthenticatedClient(accessToken, refreshToken, tokenExpiry) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    ...(tokenExpiry ? { expiry_date: tokenExpiry } : {}),
  });
  return client;
}

/**
 * Get Google user profile
 */
async function getGoogleProfile(accessToken) {
  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken });

  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

module.exports = {
  SCOPES,
  BASE_SCOPES,
  CLEANUP_SCOPES,
  STORAGE_SCOPES,
  SCOPE_BUNDLES,
  createOAuthClient,
  createPkcePair,
  getAuthUrl,
  exchangeCode,
  createAuthenticatedClient,
  getGoogleProfile,
};
