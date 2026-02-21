// src/pages/Admin.jsx
// Admin dashboard — only for users with is_admin = true in DB.
// Features:
//   - Stats overview
//   - Users segregated by plan: Admins | Pro | Free
//   - Assign/remove Pro subscription
//   - Promote/demote admin status
//   - Delete user

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import api from '../api/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function PlanBadge({ plan, status }) {
  if (plan === 'pro' && status === 'active') {
    return <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2.5 py-1 rounded-full">Pro ✓</span>;
  }
  return <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">Free</span>;
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({ u, currentUserId, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isPro = u.subscription?.plan === 'pro' && u.subscription?.status === 'active';
  const isAdminUser = u.isAdmin;
  const isSelf = u.id === currentUserId;

  async function togglePro() {
    if (!confirm(`${isPro ? 'Remove Pro from' : 'Grant Pro to'} ${u.email}?`)) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/admin/users/${u.id}/subscription`, {
        plan: isPro ? 'free' : 'pro',
        status: 'active',
      });
      onRefresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  }

  async function toggleAdmin() {
    if (isSelf) return;
    if (!confirm(`${isAdminUser ? 'Remove admin from' : 'Make admin'} ${u.email}?`)) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/admin/users/${u.id}/role`, { isAdmin: !isAdminUser });
      onRefresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed');
    } finally { setBusy(false); }
  }

  async function deleteUser() {
    if (isSelf) return;
    if (!confirm(`Permanently delete ${u.email} and all their data? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/admin/users/${u.id}`);
      onRefresh();
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
      {/* User info */}
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
            : <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-sm flex-shrink-0">
                {(u.displayName || u.email)?.[0]?.toUpperCase()}
              </div>
          }
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate max-w-40">
              {u.displayName || '—'}
              {isSelf && <span className="ml-1 text-xs text-brand-500">(you)</span>}
            </p>
            <p className="text-xs text-gray-400 truncate max-w-40">{u.email}</p>
          </div>
        </div>
      </td>

      {/* Plan */}
      <td className="px-4 py-3">
        <PlanBadge plan={u.subscription?.plan} status={u.subscription?.status} />
        {u.subscription?.currentPeriodEnd && isPro && (
          <p className="text-xs text-gray-400 mt-0.5">until {formatDate(u.subscription.currentPeriodEnd)}</p>
        )}
      </td>

      {/* Quota */}
      <td className="px-4 py-3 text-xs text-gray-500">
        {isPro ? (
          <span className="text-green-600 font-medium">Unlimited</span>
        ) : (
          <>
            <p>{u.quota?.lifetimeUsed ?? 0}/{u.quota?.lifetimeAllowance ?? 500} lifetime</p>
            <p className="text-gray-400">{u.quota?.dailyUsed ?? 0}/{u.quota?.dailyAllowance ?? 50} today</p>
          </>
        )}
      </td>

      {/* Stats */}
      <td className="px-4 py-3 text-xs text-gray-400">
        <p>{u.stats?.scanCount ?? 0} scans</p>
        <p>{u.stats?.cleanupCount ?? 0} cleanups</p>
        <p className="text-gray-300">Joined {formatDate(u.joinedAt)}</p>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        {error && <p className="text-xs text-red-500 mb-1">{error}</p>}
        <div className="flex flex-wrap gap-1.5">
          {/* Toggle Pro */}
          <button
            onClick={togglePro}
            disabled={busy}
            className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ${
              isPro
                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                : 'bg-green-50 text-green-700 hover:bg-green-100'
            }`}
          >
            {isPro ? 'Remove Pro' : 'Grant Pro'}
          </button>

          {/* Toggle Admin */}
          {!isSelf && (
            <button
              onClick={toggleAdmin}
              disabled={busy}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50 ${
                isAdminUser
                  ? 'bg-orange-50 text-orange-600 hover:bg-orange-100'
                  : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
            >
              {isAdminUser ? 'Remove Admin' : 'Make Admin'}
            </button>
          )}

          {/* Delete */}
          {!isSelf && (
            <button
              onClick={deleteUser}
              disabled={busy}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── User Section ─────────────────────────────────────────────────────────────

function UserSection({ title, icon, users, currentUserId, onRefresh, emptyMsg }) {
  const [open, setOpen] = useState(true);
  if (users.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
          <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">{users.length}</span>
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Plan</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quota</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Stats</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <UserRow key={u.id} u={u} currentUserId={currentUserId} onRefresh={onRefresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Verify admin on mount
  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await api.get('/auth/me');
        if (res.data.isAdmin) {
          setIsAdmin(true);
        } else {
          navigate('/dashboard');
        }
      } catch {
        navigate('/dashboard');
      } finally {
        setChecking(false);
      }
    }
    checkAdmin();
  }, [navigate]);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [statsRes, usersRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users', { params: { limit: 200, offset: 0 } }),
      ]);
      setStats(statsRes.data);
      setAllUsers(usersRes.data.users || []);
    } catch (err) {
      console.error('Admin load failed', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAdmin) return null;

  // Filter by search
  const filtered = search.trim()
    ? allUsers.filter(u =>
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : allUsers;

  // Segregate into sections
  const adminUsers = filtered.filter(u => u.isAdmin);
  const proUsers   = filtered.filter(u => !u.isAdmin && u.subscription?.plan === 'pro' && u.subscription?.status === 'active');
  const freeUsers  = filtered.filter(u => !u.isAdmin && !(u.subscription?.plan === 'pro' && u.subscription?.status === 'active'));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚙️</span>
            <span className="font-bold text-gray-900">Admin Dashboard</span>
            <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-700">
              ← Back to App
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Users', value: stats.totalUsers, color: 'bg-blue-50 text-blue-700' },
              { label: 'Pro Subscribers', value: stats.proUsers, color: 'bg-brand-50 text-brand-700' },
              { label: 'Scans Done', value: stats.totalScans, color: 'bg-purple-50 text-purple-700' },
              { label: 'Space Freed', value: formatBytes(stats.totalBytesFreed), color: 'bg-green-50 text-green-700' },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl p-5 ${s.color}`}>
                <p className="text-2xl font-bold">{s.value?.toLocaleString?.() ?? s.value}</p>
                <p className="text-sm font-semibold mt-1 opacity-80">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 bg-white shadow-sm"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <UserSection
              title="Admins"
              icon="👑"
              users={adminUsers}
              currentUserId={user?.id}
              onRefresh={load}
            />
            <UserSection
              title="Pro Subscribers"
              icon="⭐"
              users={proUsers}
              currentUserId={user?.id}
              onRefresh={load}
            />
            <UserSection
              title="Free Users"
              icon="👤"
              users={freeUsers}
              currentUserId={user?.id}
              onRefresh={load}
            />

            {filtered.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                {search ? 'No users match your search.' : 'No users found.'}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
