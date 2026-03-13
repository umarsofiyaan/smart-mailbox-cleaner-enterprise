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
import PaywallModal from '../components/PaywallModal';
import CustomScanBuilder, { buildQueryPreview } from '../components/CustomScanBuilder';
import PlaybooksPanel from '../components/PlaybooksPanel';
import SEOHead from '../components/SEOHead';
import api, { authApi, subscriptionApi, cleanupApi, scanApi, automationApi, userApi } from '../api/client';
import { launchRazorpayCheckout } from '../utils/razorpayCheckout';

function formatGB(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

function formatMB(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

// ── Scan type badge ───────────────────────────────────────────────────────────

function ScanTypeBadge({ scanType }) {
  if (scanType !== 'custom') return null;
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
      {/* Button pair - overflow-hidden only here for rounded corners on the joined buttons */}
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
              Scanning...
            </>
          ) : (
            <>🔍 {status === 'complete' ? 'Re-scan' : 'Scan Mailbox'}</>
          )}
        </button>

        {/* Chevron - same height, same visual weight */}
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
                Auto-scan 7 categories - large files, promotions, social, and more
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
  const [taskNotice,            setTaskNotice]            = useState(null);
  const [uiNotice,              setUiNotice]              = useState(null);
  const [pendingCleanupCategories, setPendingCleanupCategories] = useState(new Set());
  const [activeCleanupSummary,  setActiveCleanupSummary]  = useState(null);
  const [paywallOpen,           setPaywallOpen]           = useState(false);
  const [paywallPayload,        setPaywallPayload]        = useState(null);
  const [pricing,               setPricing]               = useState(null);
  const [purchaseLoadingPlan,   setPurchaseLoadingPlan]   = useState('');
  const [simulatedProgress,     setSimulatedProgress]     = useState(null);
  const [guardian,              setGuardian]              = useState(null);
  const [guardianSaving,        setGuardianSaving]        = useState(false);
  const [mailboxes,             setMailboxes]             = useState([]);
  const [mailboxLimit,          setMailboxLimit]          = useState(1);
  const [selectedMailboxId,     setSelectedMailboxId]     = useState('');
  const [mailboxBusy,           setMailboxBusy]           = useState(false);
  const profileMenuRef = useRef(null);

  const isPro       = Boolean(user?.subscription?.isPro || quota?.plan_type === 'starter' || quota?.plan_type === 'pro' || quota?.is_power_active);
  const activePlanType = quota?.is_power_active
    ? 'power'
    : (quota?.plan_type || (user?.subscription?.isPro ? 'pro' : 'free'));
  const activePlanLabel = activePlanType === 'free'
    ? 'Free'
    : activePlanType.charAt(0).toUpperCase() + activePlanType.slice(1);
  const isRunning   = status === 'running' || status === 'starting';
  const estimateCleanupMinutes = (count = 0) => {
    const n = Number(count) || 0;
    if (n <= 0) return 1;
    return Math.max(1, Math.ceil(n / 1500));
  };

  const describeCleanupStage = (action) => {
    const stage = action?.progressStage || '';
    if (stage === 'moving_to_trash') {
      const moved = Number(action?.progressMovedCount || 0);
      const total = Number(action?.progressTotalCount || action?.progressMatchedCount || 0);
      if (total > 0) return `Moving ${moved.toLocaleString()} / ${total.toLocaleString()} to Trash`;
      return 'Moving emails to Trash';
    }
    if (stage === 'resolving_ids') return 'Finding matching emails';
    if (stage === 'checking_quota') return 'Checking cleanup limits';
    if (stage === 'connecting_mailbox') return 'Connecting to Gmail';
    if (stage === 'measuring_trash') return 'Measuring current Trash';
    if (stage === 'preparing_cleanup') return 'Preparing cleanup batches';
    if (stage === 'saving_undo_snapshot') return 'Saving undo data';
    if (stage === 'finalizing_cleanup') return 'Finalizing cleanup';
    return 'Processing cleanup';
  };

  const isConflictMessage = (msg = '') =>
    typeof msg === 'string' && msg.toLowerCase().includes('already in progress');

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const markCleanupCategoryPending = (category) => {
    if (!category) return;
    setPendingCleanupCategories(prev => new Set([...prev, category]));
  };

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
    loadLatestScan(selectedMailboxId || null);
    loadQuota();
    loadPricing();
    loadGuardian();
    loadMailboxes();
    if (searchParams.get('upgrade') === 'success')       setShowUpgradeBanner(true);
    if (searchParams.get('mailbox_connected') === 'success') {
      const mailboxEmail = searchParams.get('mailbox_email');
      setUiNotice({ type: 'success', message: mailboxEmail ? `Mailbox connected: ${mailboxEmail}` : 'Mailbox connected successfully.' });
      window.history.replaceState({}, document.title, '/dashboard');
    }
    if (searchParams.get('mailbox_connected') === 'limit') {
      setUiNotice({ type: 'error', message: 'Mailbox limit reached for your plan.' });
      window.history.replaceState({}, document.title, '/dashboard');
    }
    if (searchParams.get('mailbox_connected') === 'consent_required') {
      setUiNotice({ type: 'error', message: 'Google consent is required. Please connect mailbox again.' });
      window.history.replaceState({}, document.title, '/dashboard');
    }
    if (searchParams.get('mailbox_connected') === 'error') {
      setUiNotice({ type: 'error', message: 'Failed to connect mailbox.' });
      window.history.replaceState({}, document.title, '/dashboard');
    }
    if (searchParams.get('manage') === 'subscription') {
      setShowSubscriptionModal(true);
      window.history.replaceState({}, document.title, '/dashboard');
    }
  }, [user]);

  async function loadQuota() {
    try {
      const res = await userApi.getQuota();
      const data = res.data || null;
      setQuota(data);
      return data;
    } catch { /* silent */ }
    return null;
  }

  async function loadPricing() {
    try {
      const res = await subscriptionApi.getPricing();
      setPricing(res.data || null);
    } catch {
      setPricing(null);
    }
  }

  async function loadGuardian() {
    try {
      const res = await userApi.getGuardian();
      setGuardian(res.data || null);
    } catch {
      setGuardian(null);
    }
  }

  async function loadMailboxes(preferredId = null) {
    try {
      const res = await userApi.getMailboxes();
      const items = Array.isArray(res.data?.items) ? res.data.items : [];
      const limit = Number(res.data?.limit || 1);
      setMailboxes(items);
      setMailboxLimit(limit);

      const primary = items.find((m) => m.is_primary);
      const hasMailbox = (id) => !!id && items.some((m) => m.id === id);
      const nextSelected = hasMailbox(preferredId)
        ? preferredId
        : hasMailbox(selectedMailboxId)
          ? selectedMailboxId
          : (primary?.id || items[0]?.id || '');

      setSelectedMailboxId(nextSelected);
      if (nextSelected) await loadLatestScan(nextSelected);
    } catch {
      setMailboxes([]);
      setMailboxLimit(1);
      setSelectedMailboxId('');
    }
  }

  async function handleConnectMailbox() {
    if (mailboxes.length >= mailboxLimit) {
      setUiNotice({ type: 'error', message: `Mailbox limit reached (${mailboxLimit}). Upgrade to Power for up to 5 mailboxes.` });
      return;
    }
    try {
      const res = await authApi.getGoogleConnectUrl();
      const url = res?.data?.url;
      if (!url) throw new Error('Failed to get OAuth URL.');
      window.location.href = url;
    } catch (err) {
      setUiNotice({ type: 'error', message: err?.response?.data?.error || err.message || 'Unable to start mailbox connection.' });
    }
  }

  async function handleSetPrimaryMailbox(mailboxId) {
    setMailboxBusy(true);
    try {
      await userApi.setPrimaryMailbox(mailboxId);
      await loadMailboxes(mailboxId);
      setUiNotice({ type: 'success', message: 'Primary mailbox updated.' });
    } catch (err) {
      setUiNotice({ type: 'error', message: err?.response?.data?.error || 'Failed to set primary mailbox.' });
    } finally {
      setMailboxBusy(false);
    }
  }

  async function handleRemoveMailbox(mailboxId) {
    if (!window.confirm('Disconnect this mailbox?')) return;
    setMailboxBusy(true);
    try {
      await userApi.deleteMailbox(mailboxId);
      await loadMailboxes();
      setUiNotice({ type: 'success', message: 'Mailbox disconnected.' });
    } catch (err) {
      setUiNotice({ type: 'error', message: err?.response?.data?.error || 'Failed to disconnect mailbox.' });
    } finally {
      setMailboxBusy(false);
    }
  }

  async function updateGuardian(patch) {
    if (!guardian) return;
    setGuardianSaving(true);
    try {
      const next = {
        auto_clean_enabled: patch.auto_clean_enabled ?? guardian.auto_clean_enabled,
        auto_clean_frequency: patch.auto_clean_frequency ?? guardian.auto_clean_frequency,
        auto_clean_max_inbox_mb: patch.auto_clean_max_inbox_mb ?? guardian.auto_clean_max_inbox_mb,
      };
      await userApi.updateGuardian(next);
      setGuardian((g) => ({ ...(g || {}), ...next }));
    } catch (err) {
      setUiNotice({ type: 'error', message: err?.response?.data?.error || 'Failed to update Auto Inbox Guardian.' });
    } finally {
      setGuardianSaving(false);
    }
  }

  const quotaRemaining  = Number(quota?.delete_credits ?? 0);
  const isFreeWithQuota = !isPro;
  const canAddMailbox = mailboxes.length < mailboxLimit;
  const shouldShowMailboxPowerUpsell = !quota?.is_power_active && mailboxes.length >= mailboxLimit;

  // ── Quick scan ──────────────────────────────────────────────────────────────

  function handleQuickScan() {
    setTaskNotice(null);
    setUiNotice(null);
    setCustomScanError('');
    startScan(isPro ? 'all' : '12months', selectedMailboxId || null);
  }

  // ── Custom scan ─────────────────────────────────────────────────────────────
  // Three-layer defence so this works regardless of which files are deployed:
  //   Layer 1: useScan hook has startCustomScan  -> use it (best, full progress bar)
  //   Layer 2: client.js has scanApi.startCustomScan -> call it directly
  //   Layer 3: fall back to raw axios api instance -> works with ANY client.js version

  async function handleCustomScanStart(params) {
    setTaskNotice(null);
    setUiNotice(null);
    setShowCustomScan(false);
    setCustomScanError('');

    // ── Layer 1: updated useScan.js deployed ──────────────────────────────────
    if (typeof startCustomScan === 'function') {
      startCustomScan({ ...params, mailboxId: selectedMailboxId || null });
      return;
    }

    // ── Layer 2 & 3: self-contained fallback (no hook needed) ─────────────────
    const POLL_MS = 3000;
    let pollTimer = null;
    setCustomScanError('⏳ Custom scan starting...');

    try {
      // Use scanApi.startCustomScan if it exists, otherwise hit the endpoint directly
      // via the raw `api` axios instance - works even with the old client.js
      let scanId;
      try {
        const res = typeof scanApi?.startCustomScan === 'function'
          ? await scanApi.startCustomScan({ ...params, mailboxId: selectedMailboxId || null })
          : await api.post('/scan/start-custom', { ...params, mailboxId: selectedMailboxId || null });
        scanId = res.data.scanId;
      } catch (initErr) {
        // Surface the actual HTTP error message from the backend
        const msg = initErr?.response?.data?.error || initErr?.message || 'Custom scan failed to start.';
        const status = initErr?.response?.status;
        const hint = status === 404
          ? ' - Backend route /scan/start-custom not found. Deploy backend/src/routes/scan.js to Render.'
          : status === 409
          ? ' - A scan is already running. Wait for it to finish.'
          : status === 400
          ? ' - Please set at least one filter before scanning.'
          : '';
        throw new Error(`${msg}${hint}`);
      }

      setCustomScanError('🔍 Custom scan running - results will appear shortly...');

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

      // Done - reload latest scan so UI reflects results
      setCustomScanError('');
      await loadLatestScan(selectedMailboxId || null);

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
      setUiNotice({ type: 'success', message: 'Playbook created successfully.' });
    } catch (err) {
      setUiNotice({
        type: 'error',
        message: err?.response?.data?.error || 'Failed to create playbook.',
      });
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  function handleCleanupRequest(categoryData) {
    setTaskNotice(null);
    setUiNotice(null);
    if (pendingCleanupCategories.has(categoryData.category)) {
      setTaskNotice({
        type: 'cleanup',
        message: 'A cleanup is already running for this filter. Please check Cleanup History.',
      });
      return;
    }
    setPendingCleanup(categoryData);
  }

  async function executeQueuedCleanup(cleanupPayload) {
    if (!cleanupPayload || !scan) return;
    try {
      const result = await executeCleanup({
        scanId:         scan.id,
        category:       cleanupPayload.category,
        messageIds:     cleanupPayload.messageIds,
        estimatedBytes: cleanupPayload.estimatedBytes,
        cleanupMode:    cleanupPayload.cleanupMode || 'ids',
        customQuery:    cleanupPayload.customQuery || undefined,
        expectedMessageCount: cleanupPayload.messageCount || 0,
        mailboxId:      selectedMailboxId || null,
      });

      if (result?.queued) {
        const eta = estimateCleanupMinutes(cleanupPayload.messageCount);
        const queuedCount = cleanupPayload.messageCount?.toLocaleString?.() || cleanupPayload.messageCount || 0;
        setUiNotice({
          type: 'info',
          message:
            `Cleanup queued for ${queuedCount} messages. ` +
            `Estimated time ~${eta} minute${eta > 1 ? 's' : ''}. ` +
            `You can leave this page and check Cleanup History later.`,
        });
        markCleanupCategoryPending(cleanupPayload.category);
        setPendingCleanup(null);
        setHistoryKey(k => k + 1);
        setTimeout(() => scrollToSection('cleanup-history'), 150);
        // Refresh shortly so user sees pending/completed transition.
        setTimeout(() => setHistoryKey(k => k + 1), 15000);
        return;
      }

      setPendingCleanup(null);
      setUndoAction(result);
      setHistoryKey(k => k + 1);
      await loadQuota();
      setQuotaRefreshKey(k => k + 1);
    } catch (err) {
      const msg = err?.message || 'Cleanup failed.';
      if (isConflictMessage(msg)) {
        markCleanupCategoryPending(cleanupPayload?.category);
        setTaskNotice({
          type: 'cleanup',
          message: msg,
        });
        setPendingCleanup(null);
        setHistoryKey(k => k + 1);
        return;
      }
      // If the client timed out, backend may still complete cleanup.
      if (/timeout|ECONNABORTED|Network Error/i.test(msg)) {
        setTimeout(async () => {
          await loadLatestScan(selectedMailboxId || null);
          setHistoryKey(k => k + 1);
        }, 4000);
      }
      setPendingCleanup(null);
      setUiNotice({ type: 'error', message: msg });
    }
  }

  async function handleConfirmCleanup() {
    if (!pendingCleanup || !scan) return;

    const requestedCount = Number(pendingCleanup.messageCount || pendingCleanup.messageIds?.length || 0);
    const storageMB = (requestedCount * 75) / 1024;
    const beforeBytes = Number(scan.storage?.usedBytes || 0);
    const afterBytes = Math.max(0, beforeBytes - (storageMB * 1024 * 1024));

    setSimulatedProgress({ text: 'Preparing cleanup...', percent: 0 });
    setPendingCleanup(null);

    await new Promise((resolve) => {
      setTimeout(() => setSimulatedProgress({ text: 'Preparing cleanup...', percent: 38 }), 260);
      setTimeout(() => setSimulatedProgress({ text: 'Preparing cleanup...', percent: 78 }), 720);
      setTimeout(resolve, 1050);
    });

    const latestQuota = await loadQuota();
    const latestCredits = Number((latestQuota?.delete_credits ?? quota?.delete_credits ?? 0));
    const powerActive = !!(latestQuota?.is_power_active ?? quota?.is_power_active);

    if (powerActive || latestCredits >= requestedCount) {
      setSimulatedProgress(null);
      await executeQueuedCleanup(pendingCleanup);
      return;
    }

    setPaywallPayload({
      cleanup: pendingCleanup,
      requestedCount,
      preview: {
        before: formatGB(beforeBytes),
        after: formatGB(afterBytes),
        timeSaved: `${Math.max(1, Math.round(requestedCount / 9000 * 60 / 20))} hours`,
      },
    });
    setSimulatedProgress(null);
    setPaywallOpen(true);
  }

  async function handleUnlockCleanup(planType) {
    if (!paywallPayload?.cleanup) return;
    setPurchaseLoadingPlan(planType);
    try {
      await launchRazorpayCheckout(planType);
      await loadQuota();
      setPaywallOpen(false);
      await executeQueuedCleanup(paywallPayload.cleanup);
    } catch (err) {
      setUiNotice({ type: 'error', message: err?.response?.data?.error || err.message || 'Purchase failed.' });
    } finally {
      setPurchaseLoadingPlan('');
    }
  }

  async function handleUndo(actionId) {
    setTaskNotice(null);
    setUiNotice(null);
    try {
      await undoCleanup(actionId);
      setUndoAction(null);
      setHistoryKey(k => k + 1);
      await loadLatestScan(selectedMailboxId || null);
    } catch (err) {
      const msg = err?.message || 'Undo failed.';
      if (isConflictMessage(msg)) {
        setTaskNotice({
          type: 'undo',
          message: msg,
        });
        setHistoryKey(k => k + 1);
        return;
      }
      if (/timeout|ECONNABORTED|Network Error/i.test(msg)) {
        setTimeout(async () => {
          setHistoryKey(k => k + 1);
          await loadLatestScan(selectedMailboxId || null);
        }, 5000);
        return;
      }
      setUiNotice({ type: 'error', message: msg });
    }
  }

  const categories      = scan?.categories?.filter(c => c.messageCount > 0) || [];
  const selectedMailbox = mailboxes.find((m) => m.id === selectedMailboxId) || mailboxes.find((m) => m.is_primary) || null;
  const totalFreeableGB = scan?.estimatedFreeableGB || 0;
  const emailsFound = Number(scan?.progress?.messagesScanned || 0);
  const promotionsCount = Number(categories.find(c => c.key?.includes('promotions'))?.messageCount || 0);
  const socialCount = Number(categories.find(c => c.key?.includes('social'))?.messageCount || 0);
  const newslettersCount = Number(categories.find(c => c.key?.includes('old_emails') || c.key?.includes('newsletter'))?.messageCount || 0);
  const storageSavingsMB = (emailsFound * 75) / 1024;

  const senderCounter = {};
  for (const cat of categories) {
    for (const msg of (cat.messages || [])) {
      const from = String(msg.from || '').toLowerCase();
      const token = from.includes('<') ? from.split('<')[1]?.split('>')[0] : from;
      const sender = (token || from || 'unknown').replace(/\"/g, '').trim();
      if (!sender) continue;
      senderCounter[sender] = (senderCounter[sender] || 0) + 1;
    }
  }
  const topSenders = Object.entries(senderCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  // Combined error: hook error OR local custom scan error
  const displayError = error || (customScanError && !customScanError.startsWith('⏳') && !customScanError.startsWith('🔍') ? customScanError : '');
  const infoMessage  = customScanError && (customScanError.startsWith('⏳') || customScanError.startsWith('🔍')) ? customScanError : '';
  const isScanConflictInfo = isConflictMessage(displayError);

  return (
    <div className="min-h-screen bg-gray-50">
      <SEOHead title="Dashboard" description="Private dashboard for Smart Mailbox Cleaner users." path="/dashboard" robots="noindex,nofollow" />

      {/* ── Nav ────────────────────────────────────────────────────────────── */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">Smart Mailbox Cleaner</span>
          </div>

          <div className="flex items-center gap-3">
            {isPro ? (
              <span className="text-xs bg-brand-100 text-brand-700 font-semibold px-3 py-1 rounded-full">
                {activePlanLabel} plan
              </span>
            ) : (
              <button
                onClick={() => navigate('/pricing')}
                className="text-xs bg-gradient-to-r from-brand-600 to-purple-600 text-white font-semibold px-3 py-1.5 rounded-full hover:opacity-90 transition-opacity"
              >
                View plans
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
          <p className="text-sm font-semibold">Your plan is active. Cleanup is now unlocked.</p>
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
                ? <>Last scan: {new Date(scan.completedAt).toLocaleString()}<ScanTypeBadge scanType={scan.scanDepth} /></>
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

        <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Connected mailboxes</p>
              <p className="text-xs text-gray-500 mt-1">{mailboxes.length} / {mailboxLimit} connected</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedMailboxId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setSelectedMailboxId(nextId);
                  loadLatestScan(nextId || null);
                }}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[240px]"
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.google_email}{m.is_primary ? ' (Primary)' : ''}
                  </option>
                ))}
              </select>
              <div className="flex flex-col items-start gap-1">
                <button
                  onClick={handleConnectMailbox}
                  disabled={mailboxBusy || !canAddMailbox}
                  className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Connect mailbox
                </button>
                {shouldShowMailboxPowerUpsell && (
                  <p className="text-[11px] text-amber-600 max-w-[260px] leading-relaxed">
                    Add up to 5 mailboxes with the Power plan. Power also unlocks unlimited cleanup actions while active.
                  </p>
                )}
              </div>
            </div>
          </div>
          {selectedMailbox && (
            <div className="mt-3 flex items-center gap-2 text-xs">
              {!selectedMailbox.is_primary && (
                <button
                  onClick={() => handleSetPrimaryMailbox(selectedMailbox.id)}
                  disabled={mailboxBusy}
                  className="px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  Set as primary
                </button>
              )}
              {mailboxes.length > 1 && (
                <button
                  onClick={() => handleRemoveMailbox(selectedMailbox.id)}
                  disabled={mailboxBusy}
                  className="px-2.5 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  Disconnect selected
                </button>
              )}
            </div>
          )}
        </div>

        {quota && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs text-gray-500">Emails deleted total</p>
              <p className="text-2xl font-bold text-gray-900">{Number(quota.emails_deleted_total || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs text-gray-500">Storage recovered</p>
              <p className="text-2xl font-bold text-gray-900">{formatMB(Number(quota.storage_recovered_bytes || 0))}</p>
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-xs text-gray-500">Remaining delete credits</p>
              <p className="text-2xl font-bold text-gray-900">{Number(quota.delete_credits || 0).toLocaleString()}</p>
              {quota.is_power_active && (
                <p className="text-xs text-emerald-600 mt-1">Unlimited cleanup active until {new Date(quota.plan_expiry).toLocaleDateString()}</p>
              )}
            </div>
          </div>
        )}

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
          <div className={`${isScanConflictInfo ? 'bg-blue-50 border-blue-100' : 'bg-red-50 border-red-100'} border rounded-xl px-5 py-4 mb-6`}>
            <p className={`${isScanConflictInfo ? 'text-blue-700' : 'text-red-700'} font-medium`}>
              {isScanConflictInfo
                ? displayError
                : (displayError.startsWith('❌') ? displayError : `Scan failed: ${displayError}`)}
            </p>
            {isScanConflictInfo && (
              <button
                onClick={() => scrollToSection('scan-progress')}
                className="text-blue-700 text-sm underline mt-2 block"
              >
                Go to active scan
              </button>
            )}
            {!isScanConflictInfo && (displayError.toLowerCase().includes('api') || displayError.toLowerCase().includes('disabled')) && (
              <p className="text-red-600 text-sm mt-2">
                💡 Gmail API may not be enabled.{' '}
                <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                  target="_blank" rel="noopener noreferrer" className="underline font-semibold">
                  Enable it here -&gt;
                </a>
              </p>
            )}
            {!isScanConflictInfo && (
              <button onClick={handleQuickScan} className="text-red-600 text-sm underline mt-2 block">
                Try quick scan instead
              </button>
            )}
          </div>
        )}

        {taskNotice && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 mb-6">
            <p className="text-blue-700 font-medium">{taskNotice.message}</p>
            <button
              onClick={() => scrollToSection(taskNotice.type === 'scan' ? 'scan-progress' : 'cleanup-history')}
              className="text-blue-700 text-sm underline mt-2 block"
            >
              {taskNotice.type === 'scan' ? 'Go to active scan' : 'Go to active cleanup/undo'}
            </button>
          </div>
        )}

        {uiNotice && uiNotice.type !== 'info' && (
          <div className={`border rounded-xl px-5 py-4 mb-6 ${
            uiNotice.type === 'error'
              ? 'bg-red-50 border-red-100'
              : uiNotice.type === 'success'
                ? 'bg-green-50 border-green-100'
                : 'bg-indigo-50 border-indigo-100'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <p className={`font-medium ${
                uiNotice.type === 'error'
                  ? 'text-red-700'
                  : uiNotice.type === 'success'
                    ? 'text-green-700'
                    : 'text-indigo-700'
              }`}>{uiNotice.message}</p>
              <button
                onClick={() => setUiNotice(null)}
                className="text-gray-400 hover:text-gray-600 text-sm"
                aria-label="Dismiss notice"
              >
                x
              </button>
            </div>
          </div>
        )}

        {uiNotice?.type === 'info' && (
          <div className="fixed bottom-4 right-4 z-50 max-w-md w-[calc(100vw-2rem)] sm:w-auto">
            <div className="bg-white border border-indigo-200 rounded-xl shadow-xl p-4">
              <p className="text-sm text-indigo-700 font-medium leading-snug">{uiNotice.message}</p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => {
                    scrollToSection('cleanup-history');
                    setUiNotice(null);
                  }}
                  className="text-xs font-semibold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700"
                >
                  View status
                </button>
                <button
                  onClick={() => setUiNotice(null)}
                  className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scanning progress bar */}
        <div className="mb-6" id="scan-progress">
          <ProgressBar status={status} messagesScanned={scan?.progress?.messagesScanned} scanType={scan?.scanType} />
        </div>

        {/* Quota banner */}
        <div id="quota-banner">
          <QuotaBanner isPro={isPro} refreshKey={quotaRefreshKey} />
        </div>

        {simulatedProgress && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6">
            <p className="text-sm font-semibold text-gray-900 mb-3">{simulatedProgress.text}</p>
            <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500"
                style={{ width: `${simulatedProgress.percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{simulatedProgress.percent}%</p>
          </div>
        )}

        {/* ── Scan results ─────────────────────────────────────────────────── */}
        {scan && status === 'complete' && (
          <>
            <div className="bg-white border border-gray-100 rounded-2xl p-6 mb-6 shadow-sm">
              <p className="text-xs uppercase tracking-widest font-semibold text-blue-700">Inbox Analysis Complete</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div><p className="text-xs text-gray-500">Emails Found</p><p className="text-xl font-bold text-gray-900">{emailsFound.toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Promotions</p><p className="text-xl font-bold text-gray-900">{promotionsCount.toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Social</p><p className="text-xl font-bold text-gray-900">{socialCount.toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Newsletters</p><p className="text-xl font-bold text-gray-900">{newslettersCount.toLocaleString()}</p></div>
              </div>
              <p className="text-sm text-gray-600 mt-4">
                You could free approximately <strong>{storageSavingsMB.toFixed(0)} MB</strong> of Gmail storage.
                This may save you money on Google storage upgrades.
              </p>
            </div>

            {/* Summary card */}
            {totalFreeableGB > 0 && (
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-2xl p-6 mb-6 text-white shadow-lg">
                <p className="text-brand-200 text-sm font-medium mb-1">Estimated space you can free</p>
                <p className="text-4xl font-bold mb-4">{formatGB(scan.estimatedFreeableBytes)}</p>
                <div className="flex items-center gap-4 text-sm text-brand-200 flex-wrap">
                  <span>📧 {scan.progress?.messagesScanned?.toLocaleString()} messages scanned</span>
                  <span>📁 {categories.length} {categories.length === 1 ? 'category' : 'categories'} found</span>
                  {scan.scanDepth === 'custom' && (
                    <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      🔍 Custom scan
                    </span>
                  )}
                </div>
                {scan.scanDepth === 'custom' && scan.customQuery && (
                  <p className="text-brand-300 text-xs mt-2 font-mono truncate" title={scan.customQuery}>
                    Query: {scan.customQuery}
                  </p>
                )}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-brand-100">
                  <p>Secure Google OAuth login</p>
                  <p>We never read email content</p>
                  <p>You can revoke access anytime</p>
                  <p>Your data is never stored or sold</p>
                </div>
                {!isPro && quotaRemaining === 0 && quota && (
                  <button
                    onClick={() => navigate('/pricing')}
                    className="mt-4 bg-white text-brand-700 font-bold px-5 py-2.5 rounded-xl hover:bg-brand-50 transition-colors text-sm"
                  >
                    Unlock cleanup -&gt;
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
                    <p className="font-bold mb-2">Unlock Cleanup</p>
                    <p className="text-brand-100 text-sm mb-4 leading-relaxed">
                      Choose Starter, Pro, or Power to continue deleting more emails.
                    </p>
                    <button
                      onClick={() => navigate('/pricing')}
                      className="w-full bg-white text-brand-700 font-bold py-2.5 rounded-xl text-sm hover:bg-brand-50 transition-colors"
                    >
                      See plans
                    </button>
                  </div>
                )}

                {/* Custom scan nudge (only on quick scan results) */}
                {scan.scanDepth !== 'custom' && (
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

                {guardian && (
                  <div className="bg-white border border-gray-200 rounded-2xl p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-gray-900">Auto Inbox Guardian</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Weekly cleanup for promotions/newsletters and inbox size guardrails.
                        </p>
                      </div>
                      <button
                        onClick={() => updateGuardian({ auto_clean_enabled: !guardian.auto_clean_enabled })}
                        disabled={guardianSaving}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                          guardian.auto_clean_enabled
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {guardian.auto_clean_enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <select
                        value={guardian.auto_clean_frequency || 'weekly'}
                        onChange={(e) => updateGuardian({ auto_clean_frequency: e.target.value })}
                        disabled={guardianSaving}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                      >
                        <option value="weekly">Weekly</option>
                        <option value="daily">Daily</option>
                      </select>
                      <input
                        type="number"
                        min={512}
                        value={guardian.auto_clean_max_inbox_mb || 5120}
                        onChange={(e) => setGuardian((g) => ({ ...(g || {}), auto_clean_max_inbox_mb: Number(e.target.value || 5120) }))}
                        onBlur={() => updateGuardian({ auto_clean_max_inbox_mb: guardian.auto_clean_max_inbox_mb || 5120 })}
                        disabled={guardianSaving}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                        placeholder="Max inbox MB"
                      />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">
                      Pricing ({guardian.region === 'reduced' ? 'Tier 3' : 'Tier 1'}): Lite ${guardian.plans?.lite_usd}/mo, Pro ${guardian.plans?.pro_usd}/mo.
                    </p>
                  </div>
                )}

                {topSenders.length > 0 && (
                  <div className="bg-white border border-gray-200 rounded-2xl p-5">
                    <p className="text-sm font-bold text-gray-900 mb-3">Top inbox senders</p>
                    <div className="space-y-2">
                      {topSenders.map(([sender, count]) => (
                        <div key={sender} className="flex justify-between text-sm">
                          <span className="text-gray-600 truncate pr-3">{sender}</span>
                          <span className="font-semibold text-gray-900">{count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right: categories */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="font-semibold text-gray-900 text-lg">
                  {scan.scanDepth === 'custom' ? 'Your custom search results' : 'Suggested cleanups'}
                  {!isPro && quotaRemaining > 0 && (
                    <span className="text-sm text-green-600 font-normal ml-2">
                      ({quotaRemaining} free credits available)
                    </span>
                  )}
                  {!isPro && quotaRemaining === 0 && quota && (
                    <span className="text-sm text-amber-500 font-normal ml-2">
                      (free credits used - unlock cleanup to continue)
                    </span>
                  )}
                </h2>

                {categories.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
                    <p className="text-3xl mb-3">✨</p>
                    <p className="font-semibold text-gray-900">No messages match your filters</p>
                    <p className="text-gray-400 text-sm mt-1">Try adjusting the filters in a new custom scan.</p>
                    <button
                      onClick={() => setShowCustomScan(true)}
                      className="mt-4 text-sm text-indigo-600 hover:text-indigo-700 font-semibold underline"
                    >
                      Adjust filters -&gt;
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
                      isLocked={pendingCleanupCategories.has(cat.key)}
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
              </button>
              <button
                onClick={() => document.getElementById('playbooks-panel')?.scrollIntoView({ behavior: 'smooth' })}
                className="bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 px-8 py-3 rounded-xl hover:bg-emerald-100 transition-colors"
              >
                Playbooks
              </button>
            </div>
          </div>
        )}

        {/* Cleanup History */}
        <div className="mt-8" id="cleanup-history">
          <CleanupHistory
            key={historyKey}
            onUndoSuccess={() => { setHistoryKey(k => k + 1); loadLatestScan(selectedMailboxId || null); }}
            onStateChange={(items) => {
              const pendingItems = (items || []).filter(action => action.status === 'pending');
              const next = new Set(pendingItems.map(action => action.category));
              setPendingCleanupCategories(next);
              if (pendingItems[0]) {
                setActiveCleanupSummary({
                  count: pendingItems.length,
                  label: describeCleanupStage(pendingItems[0]),
                });
              } else {
                setActiveCleanupSummary(null);
              }
            }}
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
        mailboxId={selectedMailboxId || null}
      />

      <PaywallModal
        isOpen={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onUnlock={handleUnlockCleanup}
        pricing={pricing}
        requestedCount={paywallPayload?.requestedCount || 0}
        preview={paywallPayload?.preview || null}
        loadingPlan={purchaseLoadingPlan}
      />

      {pendingCleanupCategories.size > 0 && (
        <div className="fixed bottom-4 left-4 z-50">
          <button
            onClick={() => scrollToSection('cleanup-history')}
            className="bg-indigo-600 text-white shadow-lg rounded-2xl px-4 py-3 text-left hover:bg-indigo-700"
          >
            <p className="text-sm font-semibold">
              {pendingCleanupCategories.size} cleanup{pendingCleanupCategories.size > 1 ? 's' : ''} running
            </p>
            <p className="text-xs text-indigo-100 mt-0.5">
              {activeCleanupSummary?.label || 'Working in the background'} - View
            </p>
          </button>
        </div>
      )}
    </div>
  );
}



