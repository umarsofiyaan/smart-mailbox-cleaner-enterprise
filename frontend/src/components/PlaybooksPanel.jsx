import { useEffect, useState } from 'react';
import { automationApi } from '../api/client';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

export default function PlaybooksPanel() {
  const [items, setItems] = useState([]);
  const [runs, setRuns] = useState([]);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    name: '',
    query: '',
    frequency: 'none',
    run_at_utc: '03:00',
    day_of_week: 1,
  });

  async function load() {
    try {
      const [playbooksRes, runsRes, insightsRes] = await Promise.all([
        automationApi.listPlaybooks(),
        automationApi.listRuns(10),
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
        },
      });
      setDraft({ name: '', query: '', frequency: 'none', run_at_utc: '03:00', day_of_week: 1 });
      await load();
    } catch (e2) {
      setError(e2?.response?.data?.error || 'Failed to create playbook.');
    } finally {
      setLoading(false);
    }
  }

  async function togglePlaybook(item, isActive) {
    setLoading(true);
    setError('');
    try {
      await automationApi.updatePlaybook(item.id, { is_active: isActive });
      await load();
    } catch (e) {
      setError(e?.response?.data?.error || 'Failed to update playbook.');
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
      alert(`Matches: ${p.matchedCount.toLocaleString()}\nEstimated cleanup: ${formatBytes(p.estimatedBytes)}`);
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Smart Actions</h3>
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
          {items.map((item) => (
            <div key={item.id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm text-gray-900">{item.name}</p>
                  <p className="text-xs text-gray-500 font-mono truncate">{item.query}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => previewPlaybook(item)} className="text-xs px-2 py-1 rounded-lg border border-gray-200">Preview</button>
                  <button onClick={() => runNow(item)} className="text-xs px-2 py-1 rounded-lg bg-brand-600 text-white">Run</button>
                  <button
                    onClick={() => togglePlaybook(item, !item.is_active)}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-200"
                  >
                    {item.is_active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="font-semibold text-gray-900 mb-3">Recent Automation Runs</h4>
          <div className="space-y-2">
            {runs.length === 0 && <p className="text-sm text-gray-400">No runs yet.</p>}
            {runs.map((run) => (
              <div key={run.id} className="text-xs border border-gray-100 rounded-lg p-2">
                <p className="font-semibold text-gray-700">{run.playbook_name || 'Playbook'}</p>
                <p className="text-gray-500">
                  {run.status} | matched {Number(run.matched_count || 0).toLocaleString()} | cleaned {Number(run.cleaned_count || 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h4 className="font-semibold text-gray-900 mb-3">Top Domains (Latest Scan)</h4>
          <div className="space-y-2">
            {insights.length === 0 && <p className="text-sm text-gray-400">Run a scan to populate insights.</p>}
            {insights.slice(0, 10).map((row) => (
              <div key={row.domain} className="flex items-center justify-between text-xs border border-gray-100 rounded-lg p-2">
                <span className="font-medium text-gray-700">{row.domain}</span>
                <span className="text-gray-500">{Number(row.messageCount).toLocaleString()} emails</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
