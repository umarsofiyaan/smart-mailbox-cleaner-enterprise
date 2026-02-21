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
import { subscriptionApi } from '../api/client';

function formatGB(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

export default function Dashboard() {
  const { user, logout, isNewUser, markOnboardingComplete } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { scan, status, error, startScan, loadLatestScan } = useScan();
  const { executing, undoing, lastAction, executeCleanup, undoCleanup } = useCleanup();

  const [pendingCleanup, setPendingCleanup] = useState(null);
  const [undoAction, setUndoAction] = useState(null);
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0); // increment to refresh history
  const profileMenuRef = useRef(null);

  const isPro = user?.subscription?.isPro;

  // Close profile menu when clicking outside
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

    if (searchParams.get('upgrade') === 'success') {
      setShowUpgradeBanner(true);
    }
  }, [user]);

  function handleCleanupRequest(categoryData) {
    if (!isPro) {
      navigate('/pricing');
      return;
    }
    setPendingCleanup(categoryData);
  }

  async function handleConfirmCleanup() {
    if (!pendingCleanup || !scan) return;

    try {
      const result = await executeCleanup({
        scanId: scan.id,
        category: pendingCleanup.category,
        messageIds: pendingCleanup.messageIds,
        estimatedBytes: pendingCleanup.estimatedBytes,
      });

      setPendingCleanup(null);
      setUndoAction(result);
      setHistoryKey(k => k + 1); // refresh history panel

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

  const categories = scan?.categories?.filter(c => c.messageCount > 0) || [];
  const totalFreeableGB = scan?.estimatedFreeableGB || 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📬</span>
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
                  : <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-semibold text-sm">{user?.displayName?.[0]}</div>
                }
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-50">
                    <p className="font-medium text-sm text-gray-900 truncate">{user?.displayName}</p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                  <button onClick={() => { navigate('/admin'); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
                    Admin Dashboard
                  </button>
                  {isPro && (
                    <button onClick={() => { handleManageSubscription(); setProfileMenuOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
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
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hello, {user?.displayName?.split(' ')[0]} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              {status === 'complete' && scan
                ? `Last scan: ${new Date(scan.completedAt).toLocaleString()}`
                : 'Scan your mailbox to see what you can safely free up.'}
            </p>
          </div>

          <button
            onClick={() => startScan(isPro ? 'all' : '12months')}
            disabled={status === 'running' || status === 'starting'}
            className="flex items-center gap-2 bg-brand-600 text-white font-semibold px-5 py-2.5 rounded-xl hover:bg-brand-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {(status === 'running' || status === 'starting') ? (
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
        </div>

        {/* Error state */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-red-700 font-medium">Scan failed: {error}</p>
            {(error.toLowerCase().includes('api') || error.toLowerCase().includes('disabled') || error.toLowerCase().includes('accessnotconfigured')) && (
              <p className="text-red-600 text-sm mt-2">
                💡 It looks like Gmail API may not be enabled.{' '}
                <a
                  href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline font-semibold"
                >
                  Enable it here →
                </a>
              </p>
            )}
            <button onClick={() => startScan()} className="text-red-600 text-sm underline mt-2 block">Try again</button>
          </div>
        )}

        {/* Scanning progress */}
        <div className="mb-6">
          <ProgressBar status={status} messagesScanned={scan?.progress?.messagesScanned} />
        </div>

        {/* Quota banner for free users */}
        <QuotaBanner isPro={isPro} />

        {/* Results */}
        {scan && status === 'complete' && (
          <>
            {/* Summary bar */}
            {totalFreeableGB > 0 && (
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-2xl p-6 mb-6 text-white shadow-lg">
                <p className="text-brand-200 text-sm font-medium mb-1">Estimated space you can free</p>
                <p className="text-4xl font-bold mb-4">{formatGB(scan.estimatedFreeableBytes)}</p>
                <div className="flex items-center gap-4 text-sm text-brand-200">
                  <span>📧 {scan.progress?.messagesScanned?.toLocaleString()} emails scanned</span>
                  <span>📁 {categories.length} categories found</span>
                </div>
                {!isPro && (
                  <button
                    onClick={() => navigate('/pricing')}
                    className="mt-4 bg-white text-brand-700 font-bold px-5 py-2.5 rounded-xl hover:bg-brand-50 transition-colors text-sm"
                  >
                    Upgrade to Pro to start cleaning →
                  </button>
                )}
              </div>
            )}

            {/* Two-column layout */}
            <div className="grid lg:grid-cols-3 gap-6">
              {/* Storage + info — left column */}
              <div className="lg:col-span-1 space-y-6">
                <StorageGauge storage={scan.storage} />

                {!isPro && (
                  <div className="bg-gradient-to-br from-brand-600 to-purple-700 rounded-2xl p-5 text-white">
                    <p className="font-bold mb-2">Upgrade to Pro</p>
                    <p className="text-brand-100 text-sm mb-4 leading-relaxed">
                      One click to clean everything. Undo for 30 days. Just $5/month.
                    </p>
                    <button
                      onClick={() => navigate('/pricing')}
                      className="w-full bg-white text-brand-700 font-bold py-2.5 rounded-xl text-sm hover:bg-brand-50 transition-colors"
                    >
                      See Pro Features
                    </button>
                  </div>
                )}
              </div>

              {/* Categories — right columns */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-semibold text-gray-900 text-lg">
                  Suggested cleanups
                  {!isPro && <span className="text-sm text-gray-400 font-normal ml-2">(Pro required to clean)</span>}
                </h2>

                {categories.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                    <p className="text-3xl mb-3">✨</p>
                    <p className="font-semibold text-gray-900">Your mailbox looks clean!</p>
                    <p className="text-gray-400 text-sm mt-1">No significant cleanup suggestions found.</p>
                  </div>
                ) : (
                  categories.map(cat => (
                    <CategoryCard
                      key={cat.key}
                      category={cat}
                      isPro={isPro}
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
              We'll analyze your Gmail metadata and show you exactly what you can safely archive to free up space.
            </p>
            <button
              onClick={() => startScan()}
              className="bg-brand-600 text-white font-semibold px-8 py-3 rounded-xl hover:bg-brand-700 transition-colors shadow-sm"
            >
              Start Free Scan
            </button>
          </div>
        )}

        {/* Cleanup History — always shown if there are past actions */}
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

      {/* Onboarding guide for new users */}
      {isNewUser && (
        <OnboardingGuide onComplete={markOnboardingComplete} />
      )}

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
    </div>
  );
}
