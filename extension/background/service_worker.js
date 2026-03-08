// Chrome Extension background service worker (MV3)
// Handles OAuth flow, token storage, token refresh, and scan polling.

const API_URL = 'https://api.mailboxcleaner.umarsofiyaan.shop';
const APP_URL = 'https://app.mailboxcleaner.umarsofiyaan.shop';

async function getTokens() {
  return new Promise(resolve => {
    chrome.storage.local.get(['access_token', 'refresh_token', 'user'], resolve);
  });
}

async function setTokens(accessToken, refreshToken, user) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: user || null,
    }, resolve);
  });
}

async function clearTokens() {
  return new Promise(resolve => {
    chrome.storage.local.remove(['access_token', 'refresh_token', 'user', 'last_scan'], resolve);
  });
}

async function apiRequest(path, options = {}) {
  const { access_token, refresh_token } = await getTokens();

  if (!access_token) {
    throw new Error('NOT_AUTHENTICATED');
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access_token}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    const data = await response.json().catch(() => ({}));
    if (data.code === 'TOKEN_EXPIRED' && refresh_token) {
      const refreshed = await refreshTokens(refresh_token);
      if (refreshed) {
        return apiRequest(path, options);
      }
    }
    throw new Error('NOT_AUTHENTICATED');
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP ${response.status}`);
  }

  return response.json();
}

async function refreshTokens(refreshToken) {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    if (data.accessToken) {
      const { user } = await getTokens();
      await setTokens(data.accessToken, data.refreshToken || refreshToken, user);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function initiateOAuth() {
  try {
    const response = await fetch(`${API_URL}/auth/google?state=extension`);
    const data = await response.json();

    if (data.url) {
      chrome.tabs.create({ url: data.url });
    }
  } catch (err) {
    console.error('Failed to initiate OAuth:', err);
  }
}

async function exchangeExtensionCode(code) {
  const response = await fetch(`${API_URL}/auth/extension/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to exchange extension code');
  }

  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case 'GET_AUTH_STATUS': {
        const { access_token, user } = await getTokens();
        return { authenticated: !!access_token, user: user || null };
      }

      case 'INITIATE_LOGIN': {
        await initiateOAuth();
        return { success: true };
      }

      case 'LOGOUT': {
        try {
          const { access_token } = await getTokens();
          if (access_token) {
            await fetch(`${API_URL}/auth/logout`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${access_token}` },
            });
          }
        } catch {}
        await clearTokens();
        return { success: true };
      }

      case 'START_SCAN': {
        const scanResult = await apiRequest('/scan/start', {
          method: 'POST',
          body: JSON.stringify({ scanDepth: '12months' }),
        });
        await chrome.storage.local.set({ active_scan_id: scanResult.scanId });
        return scanResult;
      }

      case 'GET_SCAN_STATUS': {
        const { active_scan_id } = await new Promise(resolve =>
          chrome.storage.local.get(['active_scan_id'], resolve)
        );
        if (!active_scan_id) return { status: 'idle' };
        return apiRequest(`/scan/${active_scan_id}`);
      }

      case 'GET_LATEST_SCAN': {
        try {
          const latest = await apiRequest('/scan/user/latest');
          return apiRequest(`/scan/${latest.scanId}`);
        } catch {
          return null;
        }
      }

      case 'OPEN_DASHBOARD': {
        chrome.tabs.create({ url: `${APP_URL}/dashboard` });
        return { success: true };
      }

      case 'OPEN_PRICING': {
        chrome.tabs.create({ url: `${APP_URL}/pricing` });
        return { success: true };
      }

      default:
        return { error: 'Unknown message type' };
    }
  };

  handle().then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });

  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url || changeInfo.status !== 'complete') return;

  const url = new URL(tab.url);
  if (url.origin !== APP_URL || url.pathname !== '/extension-auth') return;

  const code = url.searchParams.get('code');
  if (!code) return;

  try {
    const { accessToken, refreshToken } = await exchangeExtensionCode(code);
    const userData = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }).then(r => r.json()).catch(() => null);

    await setTokens(accessToken, refreshToken, userData);
    setTimeout(() => chrome.tabs.remove(tabId), 1500);
  } catch (err) {
    console.error('Failed to finish extension auth:', err);
  }
});

chrome.alarms.create('token_refresh', { periodInMinutes: 10 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token_refresh') {
    const { refresh_token, access_token } = await getTokens();
    if (refresh_token && access_token) {
      await refreshTokens(refresh_token);
    }
  }
});
