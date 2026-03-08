// src/config/google.js
require('dotenv').config();
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

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

/**
 * Generate the Google OAuth2 consent URL.
 * forceConsent=true only when we know we need a fresh refresh token.
 */
function getAuthUrl(state, forceConsent = false, loginHint = '') {
  const client = createOAuthClient();
  const params = {
    access_type: 'offline',
    scope: SCOPES,
    // Only force consent screen when explicitly needed (e.g. first login or revoked access).
    // Omitting prompt lets Google skip the consent screen for returning users
    // while still returning a refresh token if one was previously granted.
    ...(forceConsent ? { prompt: 'consent' } : { prompt: 'select_account' }),
    state: state || '',
    include_granted_scopes: true,
  };
  if (loginHint) params.login_hint = loginHint;
  return client.generateAuthUrl(params);
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Create an authenticated OAuth2 client from stored tokens.
 * tokenExpiry (Unix ms) lets the library auto-refresh before the token expires.
 */
function createAuthenticatedClient(accessToken, refreshToken, tokenExpiry) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token:  accessToken,
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
  createOAuthClient,
  getAuthUrl,
  exchangeCode,
  createAuthenticatedClient,
  getGoogleProfile,
};
