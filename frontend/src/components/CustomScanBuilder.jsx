// src/components/CustomScanBuilder.jsx
// Visual form builder for Gmail custom scans.
// Translates user-friendly dropdowns/inputs into Gmail search operators.
// Features: live count preview, grouped sections, query preview, mobile-friendly.

import { useState, useEffect, useRef, useCallback } from 'react';
import { scanApi } from '../api/client';

// ── Option definitions ─────────────────────────────────────────────────────────

const SIZE_OPTIONS = [
  { value: '', label: 'Any size' },
  { value: '1M',   label: 'Larger than 1 MB' },
  { value: '5M',   label: 'Larger than 5 MB' },
  { value: '10M',  label: 'Larger than 10 MB' },
  { value: '20M',  label: 'Larger than 20 MB' },
  { value: '50M',  label: 'Larger than 50 MB' },
  { value: '100M', label: 'Larger than 100 MB' },
];

const DATE_OPTIONS = [
  { value: '', label: 'Any date' },
  { value: '7d',   label: 'Older than 7 days' },
  { value: '30d',  label: 'Older than 1 month' },
  { value: '90d',  label: 'Older than 3 months' },
  { value: '180d', label: 'Older than 6 months' },
  { value: '1y',   label: 'Older than 1 year' },
  { value: '2y',   label: 'Older than 2 years' },
  { value: '3y',   label: 'Older than 3 years' },
  { value: '5y',   label: 'Older than 5 years' },
];

const CATEGORY_OPTIONS = [
  { value: 'all',        label: 'All categories' },
  { value: 'promotions', label: '🏷️  Promotions' },
  { value: 'social',     label: '👥  Social' },
  { value: 'updates',    label: '🔔  Updates' },
  { value: 'forums',     label: '💬  Forums' },
  { value: 'personal',   label: '👤  Personal' },
];

const HAS_OPTIONS = [
  { value: 'any',          label: 'Any content' },
  { value: 'attachment',   label: '📎  Has attachment' },
  { value: 'no_attachment',label: '✉️  No attachment' },
  { value: 'drive',        label: '☁️  Has Drive link' },
  { value: 'calendar',     label: '📅  Has calendar invite' },
];

const READ_OPTIONS = [
  { value: 'all',    label: 'Read & unread' },
  { value: 'read',   label: 'OK  Read only' },
  { value: 'unread', label: '●  Unread only' },
];

const LOCATION_OPTIONS = [
  { value: 'all',   label: 'Everywhere (except Trash/Spam)' },
  { value: 'inbox', label: '📥  Inbox only' },
  { value: 'sent',  label: '📤  Sent only' },
];

// ── Helper: build human-readable query preview string ─────────────────────────

export function buildQueryPreview(params) {
  const parts = [];
  if (params.sizeMin)   parts.push(`larger:${params.sizeMin}`);
  if (params.olderThan) parts.push(`older_than:${params.olderThan}`);
  if (params.dateFrom)  parts.push(`after:${params.dateFrom.replace(/-/g, '/')}`);
  if (params.dateTo)    parts.push(`before:${params.dateTo.replace(/-/g, '/')}`);
  if (params.category && params.category !== 'all') parts.push(`category:${params.category}`);
  if (params.hasType === 'attachment')    parts.push('has:attachment');
  else if (params.hasType === 'drive')    parts.push('has:drive');
  else if (params.hasType === 'calendar') parts.push('filename:invite.ics');
  else if (params.hasType === 'no_attachment') parts.push('-has:attachment');
  if (params.fromFilter?.trim())    parts.push(`from:${params.fromFilter.trim()}`);
  if (params.subjectFilter?.trim()) parts.push(`subject:(${params.subjectFilter.trim()})`);
  if (params.readStatus === 'read')   parts.push('is:read');
  else if (params.readStatus === 'unread') parts.push('is:unread');
  if (params.excludeStarred !== false) parts.push('-is:starred');
  if (params.location === 'inbox') parts.push('in:inbox');
  else if (params.location === 'sent') parts.push('in:sent');
  parts.push('-in:trash -in:spam');
  return parts.join(' ');
}

function hasAnyFilter(params) {
  return !!(
    params.sizeMin ||
    params.olderThan ||
    params.dateFrom ||
    params.dateTo ||
    (params.category && params.category !== 'all') ||
    (params.hasType && params.hasType !== 'any') ||
    params.fromFilter?.trim() ||
    params.subjectFilter?.trim() ||
    (params.readStatus && params.readStatus !== 'all') ||
    (params.location && params.location !== 'all')
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2.5">
      {children}
    </p>
  );
}

function Select({ value, onChange, options, disabled }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed appearance-none cursor-pointer hover:border-gray-300 transition-colors"
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function TextInput({ value, onChange, placeholder, disabled }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300 transition-colors"
    />
  );
}

function Toggle({ checked, onChange, label, sublabel }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <div className="relative mt-0.5 flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="sr-only"
        />
        <div className={`w-9 h-5 rounded-full transition-colors duration-200 ${checked ? 'bg-indigo-500' : 'bg-gray-200'}`} />
        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${checked ? 'translate-x-4' : ''}`} />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-800 group-hover:text-gray-900">{label}</p>
        {sublabel && <p className="text-xs text-gray-400 mt-0.5">{sublabel}</p>}
      </div>
    </label>
  );
}

function CountPill({ estimate, loading, isLowerBound }) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
        <span className="w-2.5 h-2.5 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        Counting...
      </span>
    );
  }
  if (estimate === null) return null;
  if (estimate === 0) {
    return (
      <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full">
        No emails match
      </span>
    );
  }
  return (
    <span className="text-xs font-bold text-indigo-700 bg-indigo-100 px-2.5 py-1 rounded-full">
      ~{estimate.toLocaleString()}{isLowerBound ? '+' : ''} emails match
    </span>
  );
}

// ── Preset quick-select buttons ───────────────────────────────────────────────

const PRESETS = [
  {
    icon: '📎',
    label: 'Big attachments',
    desc: '10 MB+ files',
    params: { sizeMin: '10M', olderThan: '', dateFrom: '', dateTo: '', hasType: 'attachment', category: 'all', readStatus: 'all', location: 'all', fromFilter: '', subjectFilter: '', excludeStarred: true },
  },
  {
    icon: '🏷️',
    label: 'Old promotions',
    desc: '1 year+ old',
    params: { sizeMin: '', olderThan: '1y', dateFrom: '', dateTo: '', hasType: 'any', category: 'promotions', readStatus: 'all', location: 'all', fromFilter: '', subjectFilter: '', excludeStarred: true },
  },
  {
    icon: '👥',
    label: 'Old social',
    desc: '6 months+ old',
    params: { sizeMin: '', olderThan: '180d', dateFrom: '', dateTo: '', hasType: 'any', category: 'social', readStatus: 'all', location: 'all', fromFilter: '', subjectFilter: '', excludeStarred: true },
  },
  {
    icon: '📖',
    label: 'Read + old',
    desc: '2 years+ old',
    params: { sizeMin: '', olderThan: '2y', dateFrom: '', dateTo: '', hasType: 'any', category: 'all', readStatus: 'read', location: 'all', fromFilter: '', subjectFilter: '', excludeStarred: true },
  },
];

// ── Default params ─────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  sizeMin:       '',
  olderThan:     '',
  dateFrom:      '',   // ISO date string YYYY-MM-DD
  dateTo:        '',   // ISO date string YYYY-MM-DD
  category:      'all',
  hasType:       'any',
  fromFilter:    '',
  subjectFilter: '',
  readStatus:    'all',
  excludeStarred: true,
  location:      'all',
};

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustomScanBuilder({ isOpen, onClose, onStart, onCreatePlaybook, isScanning, mailboxId }) {
  const [params,         setParams]         = useState(DEFAULT_PARAMS);
  const [estimate,       setEstimate]       = useState(null);
  const [estimateLowerBound, setEstimateLowerBound] = useState(false);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [showQuery,      setShowQuery]      = useState(false);
  const [error,          setError]          = useState('');

  const debounceRef = useRef(null);
  const isMounted   = useRef(true);

  useEffect(() => () => { isMounted.current = false; }, []);

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setParams(DEFAULT_PARAMS);
      setEstimate(null);
      setEstimateLowerBound(false);
      setError('');
    }
  }, [isOpen]);

  // Debounced preview fetch whenever params change
  const fetchEstimate = useCallback(async (p) => {
    if (!hasAnyFilter(p)) {
      setEstimate(null);
      setEstimateLowerBound(false);
      return;
    }
    setEstimateLoading(true);
    try {
      const res = await scanApi.previewCustomScan({ ...p, mailboxId });
      if (isMounted.current) {
        setEstimate(res.data.estimate);
        setEstimateLowerBound(!!res.data.isLowerBound);
      }
    } catch {
      if (isMounted.current) {
        setEstimate(null);
        setEstimateLowerBound(false);
      }
    } finally {
      if (isMounted.current) setEstimateLoading(false);
    }
  }, [mailboxId]);

  useEffect(() => {
    if (!isOpen) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchEstimate(params), 600);
    return () => clearTimeout(debounceRef.current);
  }, [params, isOpen, fetchEstimate]);

  function setParam(key, value) {
    setParams(prev => ({ ...prev, [key]: value }));
    setError('');
  }

  function applyPreset(preset) {
    setParams(preset.params);
    setError('');
  }

  function reset() {
    setParams(DEFAULT_PARAMS);
    setEstimate(null);
    setEstimateLowerBound(false);
    setError('');
  }

  function handleStart() {
    if (!hasAnyFilter(params)) {
      setError('Please set at least one filter before scanning.');
      return;
    }
    if (estimate === 0) {
      setError('No emails match your filters. Try different criteria.');
      return;
    }
    onStart(params);
  }

  function handleCreatePlaybook() {
    if (!hasAnyFilter(params)) {
      setError('Please set at least one filter before creating a playbook.');
      return;
    }
    onCreatePlaybook?.({
      params,
      query: buildQueryPreview(params),
    });
  }

  if (!isOpen) return null;

  const queryString = buildQueryPreview(params);
  const canStart = hasAnyFilter(params) && !isScanning;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet / Modal */}
      <div className="relative bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[96vh] sm:max-h-[90vh] rounded-t-2xl">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Custom Scan</h2>
            <p className="text-xs text-gray-400 mt-0.5">Define exactly what to find and clean</p>
          </div>
          <div className="flex items-center gap-2">
            <CountPill estimate={estimate} loading={estimateLoading} isLowerBound={estimateLowerBound} />
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors text-xl leading-none"
            >
              x
            </button>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────────────── */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">

          {/* ── Quick presets ─────────────────────────────────────────────────── */}
          <div>
            <SectionLabel>Quick presets</SectionLabel>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className="flex flex-col items-start gap-1 border border-gray-200 rounded-xl px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50 transition-all text-left group"
                >
                  <span className="text-base">{p.icon}</span>
                  <p className="text-xs font-semibold text-gray-800 group-hover:text-indigo-700 leading-tight">{p.label}</p>
                  <p className="text-xs text-gray-400">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ── Divider ─────────────────────────────────────────────────────────── */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-100" />
            <p className="text-xs text-gray-400 font-medium">or build your own</p>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* ── Size & Date row ──────────────────────────────────────────────── */}
          <div>
            <SectionLabel>Size & date</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Minimum size</label>
                <Select value={params.sizeMin} onChange={v => setParam('sizeMin', v)} options={SIZE_OPTIONS} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Age (older than)</label>
                <Select
                  value={params.olderThan}
                  onChange={v => setParam('olderThan', v)}
                  options={DATE_OPTIONS}
                  disabled={!!(params.dateFrom || params.dateTo)}
                />
              </div>
            </div>

            {/* Date range row */}
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-xs text-gray-500">Or use a specific date range</label>
                {(params.dateFrom || params.dateTo) && (
                  <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">Active - Age filter disabled</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">From date</label>
                  <input
                    type="date"
                    value={params.dateFrom}
                    max={params.dateTo || new Date().toISOString().split('T')[0]}
                    onChange={e => {
                      setParam('dateFrom', e.target.value);
                      if (e.target.value) setParam('olderThan', '');
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent hover:border-gray-300 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">To date</label>
                  <input
                    type="date"
                    value={params.dateTo}
                    min={params.dateFrom || undefined}
                    max={new Date().toISOString().split('T')[0]}
                    onChange={e => {
                      setParam('dateTo', e.target.value);
                      if (e.target.value) setParam('olderThan', '');
                    }}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent hover:border-gray-300 transition-colors"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Category & Content row ───────────────────────────────────────── */}
          <div>
            <SectionLabel>Type & content</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Gmail category</label>
                <Select value={params.category} onChange={v => setParam('category', v)} options={CATEGORY_OPTIONS} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Has</label>
                <Select value={params.hasType} onChange={v => setParam('hasType', v)} options={HAS_OPTIONS} />
              </div>
            </div>
          </div>

          {/* ── From & Subject ───────────────────────────────────────────────── */}
          <div>
            <SectionLabel>Sender & subject</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">From (email or domain)</label>
                <TextInput
                  value={params.fromFilter}
                  onChange={v => setParam('fromFilter', v)}
                  placeholder="e.g. newsletter@site.com"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Subject contains</label>
                <TextInput
                  value={params.subjectFilter}
                  onChange={v => setParam('subjectFilter', v)}
                  placeholder="e.g. invoice, receipt"
                />
              </div>
            </div>
          </div>

          {/* ── Read status & Location row ───────────────────────────────────── */}
          <div>
            <SectionLabel>Location & status</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Read status</label>
                <Select value={params.readStatus} onChange={v => setParam('readStatus', v)} options={READ_OPTIONS} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Location</label>
                <Select value={params.location} onChange={v => setParam('location', v)} options={LOCATION_OPTIONS} />
              </div>
            </div>
          </div>

          {/* ── Safety toggle ────────────────────────────────────────────────── */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <SectionLabel>Safety</SectionLabel>
            <Toggle
              checked={params.excludeStarred}
              onChange={v => setParam('excludeStarred', v)}
              label="Skip starred emails"
              sublabel="Recommended - starred emails are usually important"
            />
          </div>

          {/* ── Gmail query preview ──────────────────────────────────────────── */}
          <div>
            <button
              onClick={() => setShowQuery(v => !v)}
              className="flex items-center gap-1.5 text-xs text-indigo-500 hover:text-indigo-700 font-medium transition-colors"
            >
              <span>{showQuery ? '▼' : '▶'}</span>
              {showQuery ? 'Hide' : 'Show'} Gmail query
            </button>
            {showQuery && (
              <div className="mt-2 bg-gray-900 rounded-xl px-4 py-3 overflow-x-auto">
                <code className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
                  {queryString || '(set a filter above to see the query)'}
                </code>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────────── */}
        <div className="border-t border-gray-100 px-5 py-4 flex items-center gap-3 flex-shrink-0 bg-white rounded-b-2xl">
          <button
            onClick={reset}
            className="text-sm text-gray-400 hover:text-gray-600 font-medium transition-colors px-3 py-2 rounded-lg hover:bg-gray-100"
          >
            Reset
          </button>

          <div className="flex-1" />

          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleCreatePlaybook}
            disabled={!canStart}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create Playbook
          </button>

          <button
            onClick={handleStart}
            disabled={!canStart}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
          >
            {isScanning ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Starting...
              </>
            ) : (
              <>
                🔍 Run Custom Scan
                {estimate !== null && estimate > 0 && (
                  <span className="bg-indigo-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                    ~{estimate > 999 ? `${Math.round(estimate / 1000)}k` : estimate}{estimateLowerBound ? '+' : ''}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
