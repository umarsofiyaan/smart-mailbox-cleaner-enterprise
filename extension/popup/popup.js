// popup/popup.js — Smart Mailbox Cleaner Extension popup

const APP_URL = 'https://app.mailboxcleaner.umarsofiyaan.shop';

// ── Screen management ──────────────────────────────────────────

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(el => el.classList.add('hidden'));
  const screen = document.getElementById(screenId);
  if (screen) screen.classList.remove('hidden');
}

function $(id) { return document.getElementById(id); }

// ── Messaging helpers ─────────────────────────────────────────

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Format helpers ────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

// ── Render functions ──────────────────────────────────────────

function renderUserBar(user) {
  if (!user) return;

  $('user-name').textContent = user.displayName || user.email || 'Gmail User';

  if (user.avatarUrl) {
    $('user-avatar').src = user.avatarUrl;
    $('user-avatar').classList.remove('hidden');
    $('user-avatar-placeholder').style.display = 'none';
  } else {
    const initials = (user.displayName || user.email || '?')[0].toUpperCase();
    $('user-avatar-placeholder').textContent = initials;
  }

  const isPro = user.subscription?.isPro;
  const badge = $('plan-badge');
  badge.textContent = isPro ? 'Pro' : 'Free';
  badge.className = `plan-badge ${isPro ? 'plan-pro' : 'plan-free'}`;

  // Show/hide pro CTA
  const proCta = $('pro-cta');
  if (proCta) {
    proCta.classList.toggle('hidden', !!isPro);
  }
}

function renderStorage(storage) {
  if (!storage) return;
  $('storage-section').classList.remove('hidden');

  const pct = storage.percentUsed || 0;
  $('storage-pct').textContent = `${pct}%`;
  $('storage-used').textContent = `${formatBytes(storage.usedBytes)} used`;
  $('storage-quota').textContent = `${formatBytes(storage.quotaBytes)} total`;

  const fill = $('storage-bar-fill');
  fill.style.width = `${Math.min(pct, 100)}%`;
  fill.className = 'storage-bar-fill' + (pct >= 90 ? ' danger' : pct >= 70 ? ' warning' : '');
}

const TIER_DOT = {
  HIGH: 'dot-high',
  MEDIUM: 'dot-medium',
  REVIEW_REQUIRED: 'dot-review',
};

const CATEGORY_ICONS = {
  large_attachments_10mb: '📎',
  large_attachments_5mb: '📎',
  promotions_90d: '🏷️',
  social_90d: '👥',
  old_emails_3yr: '🕐',
  expired_calendar: '📅',
  drive_attachments: '☁️',
};

function renderCategories(categories) {
  const list = $('categories-list');
  list.innerHTML = '';

  const nonEmpty = (categories || []).filter(c => c.messageCount > 0);

  if (nonEmpty.length === 0) {
    list.innerHTML = `<p style="text-align:center;color:#9ca3af;font-size:12px;padding:8px 0;">✨ No significant cleanup needed</p>`;
    return;
  }

  for (const cat of nonEmpty.slice(0, 5)) {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <div class="category-left">
        <span class="category-icon">${CATEGORY_ICONS[cat.key] || '📧'}</span>
        <div>
          <p class="category-name">${cat.label}</p>
          <p class="category-count">
            <span class="confidence-dot ${TIER_DOT[cat.tier] || 'dot-medium'}"></span>
            ${cat.messageCount.toLocaleString()} emails
          </p>
        </div>
      </div>
      <span class="category-size">${formatBytes(cat.totalBytes)}</span>
    `;
    list.appendChild(item);
  }
}

function renderScanResults(scan) {
  if (!scan) return;

  const freeableBytes = scan.estimatedFreeableBytes || 0;
  $('result-gb').textContent = formatBytes(freeableBytes);

  renderStorage(scan.storage);
  renderCategories(scan.categories);

  $('scan-running').classList.add('hidden');
  $('scan-idle').classList.add('hidden');
  $('scan-complete').classList.remove('hidden');
}

// ── Polling ───────────────────────────────────────────────────

let pollInterval = null;

function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    try {
      const scan = await sendMessage({ type: 'GET_SCAN_STATUS' });
      if (scan?.status === 'complete') {
        stopPolling();
        renderScanResults(scan);
      } else if (scan?.status === 'failed') {
        stopPolling();
        $('scan-running').classList.add('hidden');
        $('scan-idle').classList.remove('hidden');
        $('scan-idle').querySelector('.scan-message').textContent = 'Scan failed. Please try again.';
      } else if (scan?.progress?.messagesScanned > 0) {
        $('scan-messages-count').textContent = `${scan.progress.messagesScanned.toLocaleString()} emails checked…`;
      }
    } catch {}
  }, 3000);
}

function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Init ──────────────────────────────────────────────────────

async function init() {
  showScreen('loading');

  try {
    const { authenticated, user } = await sendMessage({ type: 'GET_AUTH_STATUS' });

    if (!authenticated) {
      showScreen('login');
      return;
    }

    showScreen('dashboard');
    renderUserBar(user);

    // Try to load latest scan
    try {
      const scan = await sendMessage({ type: 'GET_LATEST_SCAN' });
      if (scan && scan.status === 'complete') {
        renderScanResults(scan);
      } else if (scan && (scan.status === 'running' || scan.status === 'pending')) {
        $('scan-idle').classList.add('hidden');
        $('scan-running').classList.remove('hidden');
        startPolling();
      }
    } catch {}

  } catch (err) {
    console.error('Init error:', err);
    showScreen('login');
  }
}

// ── Event listeners ───────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Login
  $('login-btn')?.addEventListener('click', async () => {
    $('login-btn').disabled = true;
    $('login-btn').textContent = 'Opening Google…';
    await sendMessage({ type: 'INITIATE_LOGIN' });
    // Watch for auth completion
    const checkAuth = setInterval(async () => {
      const { authenticated, user } = await sendMessage({ type: 'GET_AUTH_STATUS' });
      if (authenticated) {
        clearInterval(checkAuth);
        showScreen('dashboard');
        renderUserBar(user);
      }
    }, 1000);
    setTimeout(() => clearInterval(checkAuth), 120000); // Stop checking after 2 min
  });

  // Logout
  $('logout-btn')?.addEventListener('click', async () => {
    await sendMessage({ type: 'LOGOUT' });
    showScreen('login');
    $('login-btn').disabled = false;
    $('login-btn').innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Connect Gmail`;
  });

  // Scan button
  $('scan-btn')?.addEventListener('click', async () => {
    $('scan-idle').classList.add('hidden');
    $('scan-running').classList.remove('hidden');
    $('scan-messages-count').textContent = 'Starting scan…';

    try {
      await sendMessage({ type: 'START_SCAN' });
      startPolling();
    } catch (err) {
      $('scan-running').classList.add('hidden');
      $('scan-idle').classList.remove('hidden');
      $('scan-idle').querySelector('.scan-message').textContent = err.message || 'Scan failed. Try again.';
    }
  });

  // Re-scan
  $('rescan-btn')?.addEventListener('click', async () => {
    $('scan-complete').classList.add('hidden');
    $('scan-idle').classList.remove('hidden');
  });

  // Open dashboard
  $('open-dashboard-btn')?.addEventListener('click', () => {
    sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  // Upgrade
  $('upgrade-btn')?.addEventListener('click', () => {
    sendMessage({ type: 'OPEN_PRICING' });
  });

  init();
});
