import { useEffect, useMemo, useState } from 'react';
import { automationApi } from '../api/client';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function formatDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function defaultDraft() {
  return {
    name: '',
    query: '',
    frequency: 'none',
    run_at_utc: '03:00',
    day_of_week: 1,
  };
}

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function DomainPreview({ row }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-100 rounded-lg p-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="font-medium text-gray-700 text-xs">{row.domain}</span>
        <span className="text-gray-500 text-xs">{Number(row.messageCount).toLocaleString()} emails</span>
      </button>

      {open && (
        <div className="mt-2 border-t border-gray-100 pt-2 space-y-2 max-h-56 overflow-y-auto">
          {(row.messages || []).slice(0, 12).map((m) => (
            <div key={`${row.domain}-${m.id}`} className="text-xs border border-gray-50 rounded-md p-2">
              <p className="font-medium text-gray-700 truncate">{m.subject || '(no subject)'}</p>
              <p className="text-gray-500 truncate">{m.from}</p>
              <p className="text-gray-400">{formatDate(m.internalDate)} | {formatBytes(m.sizeEstimate)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlaybooksPanel() {
  const [items, setItems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(defaultDraft());
  const [editingId, setEditingId] = useState(null);

  const timezone = useMemo(() => getBrowserTimezone(), []);

  async function load() {
    try {
      const [playbooksRes, runsRes, insightsRes] = await Promise.all([
        automationApi.listPlaybooks(),
        automationApi.listRuns(20),
        automationApi.getDomainInsights(),
      ]);
      setItems(playbooksRes.data.items || []);
      setRuns(runsRes.data.runs || []);
      setInsights(insightsRes.data.items || []);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to load automation data.');
    }
  }

  useEffect(() => { load(); }, []);

  async function createPlaybook(e) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.query.trim()) return;
    setLoading(true);
    setError('');
    try {
      await automationApi.createPlaybook({
        name: draft.name.trim(),
        query: draft.query.trim(),
        safety_rules: { exclude_starred: true, exclude_important: false, exclude_replied_threads: false },
        schedule: {
          frequency: draft.frequency,
          run_at_utc: draft.run_at_utc,
          day_of_week: Number(draft.day_of_week),
          timezone,
        },
      });
      setDraft(defaultDraft());
      await load();
    } catch (e2) {
      setError(e2?.response?.data?.error || 'Failed to create playbook.');
    } finally {
      setLoading(false);
    }
  }

  async function saveEdit(item) {
    setLoading(true);
    setError('');
    try {
      await automationApi.updatePlaybook(item.id, {
        name: item.name,
        query: item.query,
        is_active: item.is_active,
        schedule: {
          frequency: item.frequency || 'none',
          run_at_utc: item.run_at_utc || '03:00',
          day_of_week: Number.isInteger(item.day_of_week) ? item.day_of_week : 1,
          timezone: item.timezone || timezone,
        },
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update playbook.');
    } finally {
      setLoading(false);
    }
  }

  async function removePlaybook(item) {
    if (!window.confirm(`Delete playbook "${item.name}"?`)) return;
    setLoading(true);
    setError('');
    try {
      await automationApi.deletePlaybook(item.id);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to delete playbook.');
    } finally {
      setLoading(false);
    }
  }

  async function previewPlaybook(item) {
    setLoading(true);
    setError('');
    try {
      const res = await automationApi.previewPlaybook(item.id);
      const p = res.data.preview;
      alert(`Matches: ${p.matchedCount.toLocaleString()}\nEstimated cleanup: ${formatBytes(p.estimatedBytes)}\nQuery: ${p.query}`);
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to preview playbook.');
    } finally {
      setLoading(false);
    }
  }

  async function runNow(item) {
    setLoading(true);
    setError('');
    try {
      await automationApi.runPlaybook(item.id);
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to run playbook.');
    } finally {
      setLoading(false);
    }
  }

  function updateItemInState(id, patch) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Smart Actions</h3>
        <p className="text-xs text-gray-500 mb-3">Timezone: {timezone}</p>
        <form className="grid md:grid-cols-2 gap-3" onSubmit={createPlaybook}>
          <input
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
            placeholder="Playbook name"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <input
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
            placeholder="Gmail query (e.g. category:promotions older_than:90d)"
            value={draft.query}
            onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))}
          />
          <select
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
            value={draft.frequency}
            onChange={(e) => setDraft((d) => ({ ...d, frequency: e.target.value }))}
          >
            <option value="none">No schedule</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
              value={draft.run_at_utc}
              onChange={(e) => setDraft((d) => ({ ...d, run_at_utc: e.target.value }))}
            />
            <select
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
              value={draft.day_of_week}
              onChange={(e) => setDraft((d) => ({ ...d, day_of_week: Number(e.target.value) }))}
              disabled={draft.frequency !== 'weekly'}
            >
              <option value={0}>Sun</option>
              <option value={1}>Mon</option>
              <option value={2}>Tue</option>
              <option value={3}>Wed</option>
              <option value={4}>Thu</option>
              <option value={5}>Fri</option>
              <option value={6}>Sat</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="md:col-span-2 bg-brand-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
          >
            {loading ? 'Saving...' : 'Save Playbook'}
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h4 className="font-semibold text-gray-900 mb-3">Saved Playbooks</h4>
        <div className="space-y-3">
          {items.length === 0 && <p className="text-sm text-gray-400">No playbooks yet.</p>}
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <div key={item.id} className="border border-gray-100 rounded-xl p-3 space-y-2">
                <div className="grid md:grid-cols-2 gap-2">
                  <input
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    value={item.name || ''}
                    disabled={!editing}
                    onChange={(e) => updateItemInState(item.id, { name: e.target.value })}
                  />
                  <input
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono"
                    value={item.query || ''}
                    disabled={!editing}
                    onChange={(e) => updateItemInState(item.id, { query: e.target.value })}
                  />
                </div>

                <div className="grid md:grid-cols-4 gap-2">
                  <select
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    value={item.frequency || 'none'}
                    disabled={!editing}
                    onChange={(e) => updateItemInState(item.id, { frequency: e.target.value })}
                  >
                    <option value="none">No schedule</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <input
                    type="time"
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    value={String(item.run_at_utc || '03:00').slice(0, 5)}
                    disabled={!editing}
                    onChange={(e) => updateItemInState(item.id, { run_at_utc: e.target.value })}
                  />
                  <select
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    value={Number.isInteger(item.day_of_week) ? item.day_of_week : 1}
                    disabled={!editing || (item.frequency || 'none') !== 'weekly'}
                    onChange={(e) => updateItemInState(item.id, { day_of_week: Number(e.target.value) })}
                  >
                    <option value={0}>Sun</option>
                    <option value={1}>Mon</option>
                    <option value={2}>Tue</option>
                    <option value={3}>Wed</option>
                    <option value={4}>Thu</option>
                    <option value={5}>Fri</option>
                    <option value={6}>Sat</option>
                  </select>
                  <input
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs"
                    value={item.timezone || timezone}
                    disabled={!editing}
                    onChange={(e) => updateItemInState(item.id, { timezone: e.target.value })}
                  />
                </div>

                <div className="text-xs text-gray-500">
                  v{item.version || 1} | Next run: {formatDate(item.next_run_at)}
                </div>

                <div className="flex flex-wrap gap-2">
                  {editing ? (
                    <button onClick={() => saveEdit(item)} className="text-xs px-2 py-1 rounded-lg bg-emerald-600 text-white">Save</button>
                  ) : (
                    <button onClick={() => setEditingId(item.id)} className="text-xs px-2 py-1 rounded-lg border border-gray-200">Edit</button>
                  )}
                  <button onClick={() => previewPlaybook(item)} className="text-xs px-2 py-1 rounded-lg border border-gray-200">Preview</button>
                  <button onClick={() => runNow(item)} className="text-xs px-2 py-1 rounded-lg bg-brand-600 text-white">Run</button>
                  <button
                    onClick={() => updateItemInState(item.id, { is_active: !item.is_active }) || saveEdit({ ...item, is_active: !item.is_active })}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-200"
                  >
                    {item.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => removePlaybook(item)} className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600">Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="font-semibold text-gray-900 mb-3">Recent Automation Runs</h4>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {runs.length === 0 && <p className="text-sm text-gray-400">No runs yet.</p>}
            {runs.map((run) => (
              <div key={run.id} className="text-xs border border-gray-100 rounded-lg p-2 space-y-1">
                <p className="font-semibold text-gray-700">{run.playbook_name_snapshot || run.current_playbook_name || 'Playbook'}</p>
                <p className="text-gray-500">{run.status} | matched {Number(run.matched_count || 0).toLocaleString()} | cleaned {Number(run.cleaned_count || 0).toLocaleString()}</p>
                <p className="text-gray-500">Used v{run.playbook_version_snapshot || '-'} on {formatDate(run.playbook_updated_at_snapshot)}</p>
                <p className="text-gray-400 font-mono truncate" title={run.query_snapshot}>{run.query_snapshot}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="font-semibold text-gray-900 mb-3">Top Domains (Latest Scan)</h4>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {insights.length === 0 && <p className="text-sm text-gray-400">Run a scan to populate insights.</p>}
            {insights.slice(0, 12).map((row) => (
              <DomainPreview key={row.domain} row={row} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
