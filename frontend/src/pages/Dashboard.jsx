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
import CustomScanBuilder from '../components/CustomScanBuilder';
import { subscriptionApi, cleanupApi } from '../api/client';

function formatGB(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

// ── Scan type badge shown next to "Last scan" subtitle ───────────────────────

function ScanTypeBadge({ scanType }) {
  if (!scanType || scanType === 'quick') return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full ml-1">
      🔍 Custom
    </span>
  );
}

// ── Split scan button: [Quick Scan] [▾ dropdown] ─────────────────────────────

function ScanButton({ status, isPro, onQuickScan, onCustomScan }) {
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

  return (
    <div className="relative inline-flex items-center rounded-xl overflow-hidden shadow-sm" ref={ref}>
      {/* Primary button */}
      <button
        onClick={onQuickScan}
        disabled={isRunning}
        className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-5 py-2.5 hover:bg-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isRunning ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Scanning…
          </>
        ) : (
          <>
            🔍 {status === 'complete' ? 'Re-scan' : 'Scan Mailbox'}
          </>
        )}
      </button>

      {/* Dropdown chevron - slightly darker shade */}
      <button
        onClick={() => setDropOpen(v => !v)}
        disabled={isRunning}
        aria-label="More scan options"
        className="flex items-center justify-center bg-brand-700 text-white px-4 py-2.5 hover:bg-brand-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${dropOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {dropOpen && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Quick Scan option */}
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

          {/* Custom Scan option */}
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
                Filter by size, date, sender, category, and more — your rules
              </p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, logout, isNewUser, markOnboardingComplete } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { scan, status, error, startScan, startCustomScan, loadLatestScan } = useScan();
  const { executing, undoing, lastAction, executeCleanup, undoCleanup } = useCleanup();

  const [pendingCleanup,       setPendingCleanup]       = useState(null);
  const [undoAction,           setUndoAction]           = useState(null);
  const [showUpgradeBanner,    setShowUpgradeBanner]    = useState(false);
  const [profileMenuOpen,      setProfileMenuOpen]      = useState(false);
  const [historyKey,           setHistoryKey]           = useState(0);
  const [quotaRefreshKey,      setQuotaRefreshKey]      = useState(0);
  const [quota,                setQuota]                = useState(null);
  const [showSubscriptionModal,setShowSubscriptionModal]= useState(false);
  const [showCustomScan,       setShowCustomScan]       = useState(false);
  const profileMenuRef = useRef(null);

  const isPro = user?.subscription?.isPro;

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    loadLatestScan();
    if (!isPro) loadQuota();

    if (searchParams.get('upgrade') === 'success') setShowUpgradeBanner(true);
    if (searchParams.get('manage') === 'subscription') {
      setShowSubscriptionModal(true);
      window.history.replaceState({}, document.title, '/dashboard');
    }
  }, [user]);

  async function loadQuota() {
    try {
      const res = await cleanupApi.getQuota();
      const data = res.data?.quota || res.data;
      setQuota(data);
    } catch (err) {
      console.error('Failed to load quota', err);
    }
  }

  const quotaLifetimeRemaining = quota?.lifetime?.remaining ?? 0;
  const quotaDailyRemaining    = quota?.daily?.remaining    ?? 0;
  const quotaRemaining = quotaLifetimeRemaining > 0 ? quotaLifetimeRemaining : quotaDailyRemaining;
  const isFreeWithQuota = !isPro && quotaRemaining > 0;

  function handleQuickScan() {
    startScan(isPro ? 'all' : '12months');
  }

  function handleCustomScanStart(params) {
    setShowCustomScan(false);
    startCustomScan(params);
  }

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
      });

      setPendingCleanup(null);
      setUndoAction(result);
      setHistoryKey(k => k + 1);
      if (!isPro) {
        loadQuota();
        setQuotaRefreshKey(k => k + 1);
      }
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

  async function handleManageSubscription() {
    try {
      const response = await subscriptionApi.createPortal();
      window.location.href = response.data.url;
    } catch {
      alert('Could not open billing portal. Please try again.');
    }
  }

  const categories   = scan?.categories?.filter(c => c.messageCount > 0) || [];
  const totalFreeableGB = scan?.estimatedFreeableGB || 0;
  const isRunning    = status === 'running' || status === 'starting';

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
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
                onClick={() => setProfileMenuOpen(prev => !prev)}
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
                    <button onClick={() => { navigate('/admin'); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      👑 Admin Dashboard
                    </button>
                  )}
                  {isPro && (
                    <button onClick={() => { setShowSubscriptionModal(true); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                      Manage subscription
                    </button>
                  )}
                  <button onClick={() => { navigate('/pricing'); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    Pricing
                  </button>
                  <button onClick={() => { logout(); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50">
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

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hello, {user?.displayName?.split(' ')[0]} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1 flex items-center gap-1">
              {status === 'complete' && scan
                ? <>Last scan: {new Date(scan.completedAt).toLocaleString()}<ScanTypeBadge scanType={scan.scanType} /></>
                : 'Scan your mailbox to see what you can safely free up.'
              }
            </p>
          </div>

          {/* ── Split scan button ─────────────────────────────────────────────── */}
          <ScanButton
            status={status}
            isPro={isPro}
            onQuickScan={handleQuickScan}
            onCustomScan={() => setShowCustomScan(true)}
          />
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-red-700 font-medium">Scan failed: {error}</p>
            {(error.toLowerCase().includes('api') || error.toLowerCase().includes('disabled')) && (
              <p className="text-red-600 text-sm mt-2">
                💡 Gmail API may not be enabled.{' '}
                <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  Enable it here →
                </a>
              </p>
            )}
            <button onClick={handleQuickScan} className="text-red-600 text-sm underline mt-2 block">Try again</button>
          </div>
        )}

        {/* Scanning progress */}
        <div className="mb-6">
          <ProgressBar status={status} messagesScanned={scan?.progress?.messagesScanned} scanType={scan?.scanType} />
        </div>

        {/* Quota banner */}
        <div id="quota-banner">
          <QuotaBanner isPro={isPro} refreshKey={quotaRefreshKey} />
        </div>

        {/* ── Results ─────────────────────────────────────────────────────────── */}
        {scan && status === 'complete' && (
          <>
            {/* Summary bar */}
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
              {/* Left: storage + upsell */}
              <div className="lg:col-span-1 space-y-6">
                <StorageGauge storage={scan.storage} />

                {!isPro && (
                  <div className="bg-gradient-to-br from-brand-600 to-purple-700 rounded-2xl p-5 text-white">
                    <p className="font-bold mb-2">Upgrade to Pro</p>
                    <p className="text-brand-100 text-sm mb-4 leading-relaxed">
                      One click to clean everything. Undo for 30 days. Just ₹500/month.
                    </p>
                    <button
                      onClick={() => navigate('/pricing')}
                      className="w-full bg-white text-brand-700 font-bold py-2.5 rounded-xl text-sm hover:bg-brand-50 transition-colors"
                    >
                      See Pro Features
                    </button>
                  </div>
                )}

                {/* Custom scan prompt (when on quick scan results) */}
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
              </div>

              {/* Right: categories */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-semibold text-gray-900 text-lg">
                  {scan.scanType === 'custom' ? 'Your custom search results' : 'Suggested cleanups'}
                  {!isPro && quotaRemaining > 0 && (
                    <span className="text-sm text-green-600 font-normal ml-2">({quotaRemaining} free credits available)</span>
                  )}
                  {!isPro && quotaRemaining === 0 && quota && (
                    <span className="text-sm text-amber-500 font-normal ml-2">(free quota used — upgrade for more)</span>
                  )}
                </h2>

                {categories.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                    <p className="text-3xl mb-3">✨</p>
                    <p className="font-semibold text-gray-900">No emails match your filters</p>
                    <p className="text-gray-400 text-sm mt-1">Try adjusting the date, size, or category filters.</p>
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
              or use <strong>Custom Scan</strong> to search with your own filters.
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
              </button>
            </div>
          </div>
        )}

        {/* Cleanup History */}
        <div className="mt-8">
          <CleanupHistory
            key={historyKey}
            onUndoSuccess={() => {
              setHistoryKey(k => k + 1);
              loadLatestScan();
            }}
          />
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

      {/* Custom Scan Builder */}
      <CustomScanBuilder
        isOpen={showCustomScan}
        onClose={() => setShowCustomScan(false)}
        onStart={handleCustomScanStart}
        isScanning={isRunning}
      />
    </div>
  );
}
