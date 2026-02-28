// src/pages/Dashboard.jsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useScan } from '../hooks/useScan';
import { useCleanup } from '../hooks/useCleanup';
import StorageGauge from '../components/StorageGauge';
import CategoryCard from '../components/CategoryCard';
import ConfirmModal from '../components/ConfirmModal';
import UndoAlert from '../components/UndoAlert';
import ProgressBar from '../components/ProgressBar';
import CleanupHistory from '../components/CleanupHistory';
import OnboardingGuide from '../components/OnboardingGuide';
import QuotaBanner from '../components/QuotaBanner';
import SubscriptionModal from '../components/SubscriptionModal';
import CustomScanBuilder, { buildQueryPreview } from '../components/CustomScanBuilder';
import PlaybooksPanel from '../components/PlaybooksPanel';
import api, { subscriptionApi, cleanupApi, scanApi, automationApi } from '../api/client';

function formatGB(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

// ── Scan type badge ───────────────────────────────────────────────────────────

function ScanTypeBadge({ scanType }) {
  if (!scanType || scanType === 'quick') return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full ml-1">
      🔍 Custom
    </span>
  );
}

// ── Split scan button ─────────────────────────────────────────────────────────
// Primary "Re-scan / Scan Mailbox" button + darker chevron that opens dropdown.

function ScanButton({ status, onQuickScan, onCustomScan }) {
  const [dropOpen, setDropOpen] = useState(false);
  const ref = useRef(null);
  const isRunning = status === 'running' || status === 'starting';

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setDropOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const btnBase = 'h-11 flex items-center justify-center text-white font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm';

  return (
    <div className="relative" ref={ref}>
      {/* Button pair — overflow-hidden only here for rounded corners on the joined buttons */}
      <div className="flex items-stretch rounded-xl overflow-hidden shadow-sm">

        {/* Primary action */}
        <button
          onClick={onQuickScan}
          disabled={isRunning}
          className={`${btnBase} gap-2 bg-brand-600 hover:bg-brand-700 px-5 border-r border-brand-900/30`}
          style={{ borderRadius: 0 }}
        >
          {isRunning ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Scanning…
            </>
          ) : (
            <>🔍 {status === 'complete' ? 'Re-scan' : 'Scan Mailbox'}</>
          )}
        </button>

        {/* Chevron — same height, same visual weight */}
        <button
          onClick={() => setDropOpen(v => !v)}
          disabled={isRunning}
          aria-label="More scan options"
          className={`${btnBase} bg-brand-600 hover:bg-brand-700 px-3.5`}
          style={{ borderRadius: 0 }}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-150 ${dropOpen ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Dropdown */}
      {dropOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50">

          <button
            onClick={() => { setDropOpen(false); onQuickScan(); }}
            className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-50"
          >
            <span className="text-xl mt-0.5">⚡</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Quick Scan</p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                Auto-scan 7 categories — large files, promotions, social, and more
              </p>
            </div>
          </button>

          <button
            onClick={() => { setDropOpen(false); onCustomScan(); }}
            className="w-full flex items-start gap-3 px-4 py-3.5 hover:bg-indigo-50 transition-colors text-left"
          >
            <span className="text-xl mt-0.5">🎛️</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Custom Scan
                <span className="ml-1.5 text-xs font-bold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded-full">New</span>
              </p>
              <p className="text-xs text-gray-400 mt-0.5 leading-snug">
                Filter by size, date, sender, category and more
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, logout, isNewUser, markOnboardingComplete } = useAuth();
  const navigate      = useNavigate();
  const [searchParams] = useSearchParams();

  // useScan provides scan state. startCustomScan may be undefined on old hook versions.
  const {
    scan,
    status,
    error,
    startScan,
    startCustomScan,
    loadLatestScan,
  } = useScan();

  const { executing, undoing, executeCleanup, undoCleanup } = useCleanup();

  const [pendingCleanup,        setPendingCleanup]        = useState(null);
  const [undoAction,            setUndoAction]            = useState(null);
  const [showUpgradeBanner,     setShowUpgradeBanner]     = useState(false);
  const [profileMenuOpen,       setProfileMenuOpen]       = useState(false);
  const [historyKey,            setHistoryKey]            = useState(0);
  const [quotaRefreshKey,       setQuotaRefreshKey]       = useState(0);
  const [quota,                 setQuota]                 = useState(null);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [showCustomScan,        setShowCustomScan]        = useState(false);
  const [customScanError,       setCustomScanError]       = useState(''); // separate error for custom scan init failures
  const profileMenuRef = useRef(null);

  const isPro       = user?.subscription?.isPro;
  const isRunning   = status === 'running' || status === 'starting';

  // Close profile menu on outside click
  useEffect(() => {
    function handler(e) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadLatestScan();
    if (!isPro) loadQuota();
    if (searchParams.get('upgrade') === 'success')       setShowUpgradeBanner(true);
    if (searchParams.get('manage') === 'subscription') {
      setShowSubscriptionModal(true);
      window.history.replaceState({}, document.title, '/dashboard');
    }
  }, [user]);

  async function loadQuota() {
    try {
      const res  = await cleanupApi.getQuota();
      const data = res.data?.quota || res.data;
      setQuota(data);
    } catch { /* silent */ }
  }

  const quotaLifetimeRemaining = quota?.lifetime?.remaining ?? 0;
  const quotaDailyRemaining    = quota?.daily?.remaining    ?? 0;
  const quotaRemaining  = quotaLifetimeRemaining > 0 ? quotaLifetimeRemaining : quotaDailyRemaining;
  const isFreeWithQuota = !isPro && quotaRemaining > 0;

  // ── Quick scan ──────────────────────────────────────────────────────────────

  function handleQuickScan() {
    setCustomScanError('');
    startScan(isPro ? 'all' : '12months');
  }

  // ── Custom scan ─────────────────────────────────────────────────────────────
  // Three-layer defence so this works regardless of which files are deployed:
  //   Layer 1: useScan hook has startCustomScan  → use it (best, full progress bar)
  //   Layer 2: client.js has scanApi.startCustomScan → call it directly
  //   Layer 3: fall back to raw axios api instance → works with ANY client.js version

  async function handleCustomScanStart(params) {
    setShowCustomScan(false);
    setCustomScanError('');

    // ── Layer 1: updated useScan.js deployed ──────────────────────────────────
    if (typeof startCustomScan === 'function') {
      startCustomScan(params);
      return;
    }

    // ── Layer 2 & 3: self-contained fallback (no hook needed) ─────────────────
    const POLL_MS = 3000;
    let pollTimer = null;
    setCustomScanError('⏳ Custom scan starting…');

    try {
      // Use scanApi.startCustomScan if it exists, otherwise hit the endpoint directly
      // via the raw `api` axios instance — works even with the old client.js
      let scanId;
      try {
        const res = typeof scanApi?.startCustomScan === 'function'
          ? await scanApi.startCustomScan(params)
          : await api.post('/scan/custom', params);
        scanId = res.data.scanId;
      } catch (initErr) {
        // Surface the actual HTTP error message from the backend
        const msg = initErr?.response?.data?.error || initErr?.message || 'Custom scan failed to start.';
        const status = initErr?.response?.status;
        const hint = status === 404
          ? ' — Backend route /scan/custom not found. Deploy backend/src/routes/scan.js to Render.'
          : status === 409
          ? ' — A scan is already running. Wait for it to finish.'
          : status === 400
          ? ' — Please set at least one filter before scanning.'
          : '';
        throw new Error(`${msg}${hint}`);
      }

      setCustomScanError('🔍 Custom scan running — results will appear shortly…');

      // Poll until complete or failed
      await new Promise((resolve, reject) => {
        pollTimer = setInterval(async () => {
          try {
            const res = typeof scanApi?.getScan === 'function'
              ? await scanApi.getScan(scanId)
              : await api.get(`/scan/${scanId}`);
            const data = res.data;
            if (data.status === 'complete') {
              clearInterval(pollTimer);
              resolve(data);
            } else if (data.status === 'failed') {
              clearInterval(pollTimer);
              reject(new Error(data.error || 'Custom scan failed on server.'));
            }
          } catch (pollErr) {
            clearInterval(pollTimer);
            reject(pollErr);
          }
        }, POLL_MS);
      });

      // Done — reload latest scan so UI reflects results
      setCustomScanError('');
      await loadLatestScan();

    } catch (err) {
      if (pollTimer) clearInterval(pollTimer);
      setCustomScanError(`❌ ${err.message}`);
    }
  }

  async function handleCreatePlaybookFromCustom({ params, query }) {
    const name = window.prompt('Playbook name');
    if (!name?.trim()) return;

    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      await automationApi.createPlaybook({
        name: name.trim(),
        query: query || buildQueryPreview(params),
        safety_rules: {
          exclude_starred: params.excludeStarred !== false,
          exclude_important: false,
          exclude_replied_threads: false,
        },
        schedule: {
          frequency: 'none',
          run_at_utc: '03:00',
          timezone,
        },
      });
      setShowCustomScan(false);
      alert('Playbook created successfully.');
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to create playbook.');
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  function handleCleanupRequest(categoryData) {
    if (!isPro && quotaRemaining <= 0) {
      document.getElementById('quota-banner')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setPendingCleanup(categoryData);
  }

  async function handleConfirmCleanup() {
    if (!pendingCleanup || !scan) return;
    try {
      const result = await executeCleanup({
        scanId:         scan.id,
        category:       pendingCleanup.category,
        messageIds:     pendingCleanup.messageIds,
        estimatedBytes: pendingCleanup.estimatedBytes,
        cleanupMode:    pendingCleanup.cleanupMode || 'ids',
        customQuery:    pendingCleanup.customQuery || undefined,
      });
      setPendingCleanup(null);
      setUndoAction(result);
      setHistoryKey(k => k + 1);
      if (!isPro) { loadQuota(); setQuotaRefreshKey(k => k + 1); }
    } catch (err) {
      setPendingCleanup(null);
      alert(err.message);
    }
  }

  async function handleUndo(actionId) {
    try {
      await undoCleanup(actionId);
      setUndoAction(null);
      setHistoryKey(k => k + 1);
      await loadLatestScan();
    } catch (err) {
      alert(err.message);
    }
  }

  const categories      = scan?.categories?.filter(c => c.messageCount > 0) || [];
  const totalFreeableGB = scan?.estimatedFreeableGB || 0;

  // Combined error: hook error OR local custom scan error
  const displayError = error || (customScanError && !customScanError.startsWith('⏳') && !customScanError.startsWith('🔍') ? customScanError : '');
  const infoMessage  = customScanError && (customScanError.startsWith('⏳') || customScanError.startsWith('🔍')) ? customScanError : '';

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">Smart Mailbox Cleaner</span>
          </div>

          <div className="flex items-center gap-3">
            {isPro ? (
              <span className="text-xs bg-brand-100 text-brand-700 font-semibold px-3 py-1 rounded-full">Pro</span>
            ) : (
              <button
                onClick={() => navigate('/pricing')}
                className="text-xs bg-gradient-to-r from-brand-600 to-purple-600 text-white font-semibold px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
              >
                Upgrade to Pro
              </button>
            )}

            <div className="relative" ref={profileMenuRef}>
              <button
                onClick={() => setProfileMenuOpen(p => !p)}
                className="flex items-center gap-2 focus:outline-none"
              >
                {user?.avatarUrl
                  ? <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
                  : <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-semibold text-sm">
                      {user?.displayName?.[0]}
                    </div>
                }
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-50">
                    <p className="font-medium text-sm text-gray-900 truncate">{user?.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                  {user?.isAdmin && (
                    <button onClick={() => { navigate('/admin'); setProfileMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      👑 Admin Dashboard
                    </button>
                  )}
                  {isPro && (
                    <button onClick={() => { setShowSubscriptionModal(true); setProfileMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      Manage subscription
                    </button>
                  )}
                  <button onClick={() => { navigate('/pricing'); setProfileMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    Pricing
                  </button>
                  <button onClick={() => { logout(); setProfileMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50">
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Upgrade success banner */}
      {showUpgradeBanner && (
        <div className="bg-green-600 text-white text-center py-3 px-4">
          <p className="text-sm font-semibold">🎉 Welcome to Pro! Bulk cleanup is now unlocked.</p>
          <button onClick={() => setShowUpgradeBanner(false)} className="ml-4 text-white/70 hover:text-white text-xs underline">Dismiss</button>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-8">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hello, {user?.displayName?.split(' ')[0]} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1 flex items-center gap-1 flex-wrap">
              {status === 'complete' && scan
                ? <>Last scan: {new Date(scan.completedAt).toLocaleString()}<ScanTypeBadge scanType={scan.scanType} /></>
                : 'Scan your mailbox to see what you can safely free up.'
              }
            </p>
          </div>

          <ScanButton
            status={status}
            onQuickScan={handleQuickScan}
            onCustomScan={() => setShowCustomScan(true)}
          />
        </div>

        {/* ── Error / Info banners ─────────────────────────────────────────── */}

        {/* Fallback-path info (custom scan running without hook) */}
        {infoMessage && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-4 mb-6 flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin flex-shrink-0" />
            <p className="text-indigo-800 font-medium text-sm">{infoMessage}</p>
          </div>
        )}

        {/* Error (scan failed or custom scan init failed) */}
        {displayError && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-red-700 font-medium">
              {displayError.startsWith('❌') ? displayError : `Scan failed: ${displayError}`}
            </p>
            {(displayError.toLowerCase().includes('api') || displayError.toLowerCase().includes('disabled')) && (
              <p className="text-red-600 text-sm mt-2">
                💡 Gmail API may not be enabled.{' '}
                <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                  target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  Enable it here →
                </a>
              </p>
            )}
            <button onClick={handleQuickScan} className="text-red-600 text-sm underline mt-2 block">
              Try quick scan instead
            </button>
          </div>
        )}

        {/* Scanning progress bar */}
        <div className="mb-6">
          <ProgressBar status={status} messagesScanned={scan?.progress?.messagesScanned} scanType={scan?.scanType} />
        </div>

        {/* Quota banner */}
        <div id="quota-banner">
          <QuotaBanner isPro={isPro} refreshKey={quotaRefreshKey} />
        </div>

        {/* ── Scan results ─────────────────────────────────────────────────── */}
        {scan && status === 'complete' && (
          <>
            {/* Summary card */}
            {totalFreeableGB > 0 && (
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-2xl p-6 mb-6 text-white shadow-lg">
                <p className="text-brand-200 text-sm font-medium mb-1">Estimated space you can free</p>
                <p className="text-4xl font-bold mb-4">{formatGB(scan.estimatedFreeableBytes)}</p>
                <div className="flex items-center gap-4 text-sm text-brand-200 flex-wrap">
                  <span>📧 {scan.progress?.messagesScanned?.toLocaleString()} emails scanned</span>
                  <span>📁 {categories.length} {categories.length === 1 ? 'category' : 'categories'} found</span>
                  {scan.scanType === 'custom' && (
                    <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      🔍 Custom scan
                    </span>
                  )}
                </div>
                {scan.scanType === 'custom' && scan.customQuery && (
                  <p className="text-brand-300 text-xs mt-2 font-mono truncate" title={scan.customQuery}>
                    Query: {scan.customQuery}
                  </p>
                )}
                {!isPro && quotaRemaining === 0 && quota && (
                  <button
                    onClick={() => navigate('/pricing')}
                    className="mt-4 bg-white text-brand-700 font-bold px-5 py-2.5 rounded-xl hover:bg-brand-50 transition-colors text-sm"
                  >
                    Upgrade to Pro for unlimited →
                  </button>
                )}
              </div>
            )}

            {/* Two-column layout */}
            <div className="grid lg:grid-cols-3 gap-6">

              {/* Left: storage + upsells */}
              <div className="lg:col-span-1 space-y-6">
                <StorageGauge storage={scan.storage} />

                {!isPro && (
                  <div className="bg-gradient-to-br from-brand-600 to-purple-700 rounded-2xl p-5 text-white">
                    <p className="font-bold mb-2">Upgrade to Pro</p>
                    <p className="text-brand-100 text-sm mb-4 leading-relaxed">
                      One click to clean everything. Undo for 30 days. Just ₹449/month.
                    </p>
                    <button
                      onClick={() => navigate('/pricing')}
                      className="w-full bg-white text-brand-700 font-bold py-2.5 rounded-xl text-sm hover:bg-brand-50 transition-colors"
                    >
                      See Pro Features
                    </button>
                  </div>
                )}

                {/* Custom scan nudge (only on quick scan results) */}
                {scan.scanType !== 'custom' && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5">
                    <p className="font-bold text-indigo-900 text-sm mb-1">Want more control?</p>
                    <p className="text-indigo-600 text-xs mb-3 leading-relaxed">
                      Use Custom Scan to filter by sender, size, date range, and more.
                    </p>
                    <button
                      onClick={() => setShowCustomScan(true)}
                      className="w-full bg-indigo-600 text-white font-bold py-2 rounded-xl text-sm hover:bg-indigo-700 transition-colors"
                    >
                      🎛️ Try Custom Scan
                    </button>
                  </div>
                )}

                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5">
                  <p className="font-bold text-emerald-900 text-sm mb-1">Need automation?</p>
                  <p className="text-emerald-700 text-xs mb-3 leading-relaxed">
                    Save filters as Playbooks and run them daily or weekly automatically.
                  </p>
                  <button
                    onClick={() => document.getElementById('playbooks-panel')?.scrollIntoView({ behavior: 'smooth' })}
                    className="w-full bg-emerald-600 text-white font-bold py-2 rounded-xl text-sm hover:bg-emerald-700 transition-colors"
                  >
                    Open Playbooks
                  </button>
                </div>
              </div>

              {/* Right: categories */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-semibold text-gray-900 text-lg">
                  {scan.scanType === 'custom' ? 'Your custom search results' : 'Suggested cleanups'}
                  {!isPro && quotaRemaining > 0 && (
                    <span className="text-sm text-green-600 font-normal ml-2">
                      ({quotaRemaining} free credits available)
                    </span>
                  )}
                  {!isPro && quotaRemaining === 0 && quota && (
                    <span className="text-sm text-amber-500 font-normal ml-2">
                      (free quota used — upgrade for more)
                    </span>
                  )}
                </h2>

                {categories.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                    <p className="text-3xl mb-3">✨</p>
                    <p className="font-semibold text-gray-900">No emails match your filters</p>
                    <p className="text-gray-400 text-sm mt-1">Try adjusting the filters in a new custom scan.</p>
                    <button
                      onClick={() => setShowCustomScan(true)}
                      className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-semibold underline"
                    >
                      Adjust filters →
                    </button>
                  </div>
                ) : (
                  categories.map(cat => (
                    <CategoryCard
                      key={cat.key}
                      category={cat}
                      isPro={isPro}
                      isFreeWithQuota={isFreeWithQuota}
                      quotaRemaining={quotaRemaining}
                      isLoading={executing}
                      onCleanup={handleCleanupRequest}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {/* Empty state */}
        {status === 'idle' && !scan && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
            <p className="text-5xl mb-4">📬</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Ready to scan your mailbox</h2>
            <p className="text-gray-400 mb-6 max-w-md mx-auto">
              Choose <strong>Quick Scan</strong> to automatically find large files and old emails,
              or <strong>Custom Scan</strong> to search with your own filters.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={handleQuickScan}
                className="bg-brand-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-brand-700 transition-colors shadow-sm"
              >
                ⚡ Quick Scan
              </button>
              <button
                onClick={() => setShowCustomScan(true)}
                className="bg-indigo-50 text-indigo-700 font-semibold border border-indigo-200 px-8 py-3 rounded-xl hover:bg-indigo-100 transition-colors"
              >
                🎛️ Custom Scan
              </button>              <button
                onClick={() => document.getElementById('playbooks-panel')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 px-8 py-3 rounded-xl hover:bg-emerald-100 transition-colors"
              >
                Playbooks
              </button>
            </div>
          </div>
        )}

        {/* Cleanup History */}
        <div className="mt-8">
          <CleanupHistory
            key={historyKey}
            onUndoSuccess={() => { setHistoryKey(k => k + 1); loadLatestScan(); }}
          />
        </div>

        <div className="mt-8" id="playbooks-panel">
          <PlaybooksPanel />
        </div>
      </main>

      {/* Onboarding */}
      {isNewUser && <OnboardingGuide onComplete={markOnboardingComplete} />}

      {/* Modals */}
      <ConfirmModal
        isOpen={!!pendingCleanup}
        pending={pendingCleanup}
        onConfirm={handleConfirmCleanup}
        onCancel={() => setPendingCleanup(null)}
        isExecuting={executing}
      />

      <UndoAlert
        action={undoAction}
        onUndo={handleUndo}
        onDismiss={() => setUndoAction(null)}
        isUndoing={undoing}
      />

      {showSubscriptionModal && (
        <SubscriptionModal user={user} onClose={() => setShowSubscriptionModal(false)} />
      )}

      <CustomScanBuilder
        isOpen={showCustomScan}
        onClose={() => setShowCustomScan(false)}
        onStart={handleCustomScanStart}
        onCreatePlaybook={handleCreatePlaybookFromCustom}
        isScanning={isRunning}
      />
    </div>
  );
}

