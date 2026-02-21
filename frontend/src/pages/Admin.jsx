// src/pages/Admin.jsx
// Admin dashboard — only for users with is_admin = true in DB.
// Features:
//   - Stats overview (total users, pro, scans, space freed, new this week)
//   - Users table with: email, plan, role, quota remaining, stats, last action
//   - Assign/remove Pro subscription
//   - Promote/demote admin status
//   - Reset quota
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

function timeAgo(d) {
  if (!d) return '—';
  const seconds = Math.floor((Date.now() - new Date(d)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(d);
}

function PlanBadge({ plan, status }) {
  if (plan === 'pro' && status === 'active') {
    return <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">⭐ Pro</span>;
  }
  return <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">Free</span>;
}

function RoleBadge({ isAdmin }) {
  if (isAdmin) {
    return <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">👑 Admin</span>;
  }
  return <span className="bg-gray-100 text-gray-400 text-xs px-2 py-0.5 rounded-full">User</span>;
}

// ─── User Row ─────────────────────────────────────────────────────────────────

function UserRow({ u, currentUserId, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showQuotaEdit, setShowQuotaEdit] = useState(false);
  const [quotaInput, setQuotaInput] = useState(u.quota?.lifetimeAllowance ?? 500);

  const isPro = u.subscription?.plan === 'pro' && u.subscription?.status === 'active';
  const isAdminUser = u.isAdmin;
  const isSelf = u.id === currentUserId;

  const lifetimeRemaining = isPro
    ? null
    : Math.max(0, (u.quota?.lifetimeAllowance ?? 500) - (u.quota?.lifetimeUsed ?? 0));

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

  async function resetQuota() {
    if (!confirm(`Reset quota for ${u.email} to ${quotaInput} lifetime emails?`)) return;
    setBusy(true); setError('');
    try {
      await api.patch(`/admin/users/${u.id}/quota`, {
        lifetimeAllowance: parseInt(quotaInput),
        lifetimeUsed: 0,
        dailyAllowance: 50,
      });
      setShowQuotaEdit(false);
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
    <tr className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors">
      {/* User */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {u.avatarUrl
            ? <img src={u.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
            : <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                {(u.displayName || u.email)?.[0]?.toUpperCase()}
              </div>
          }
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate max-w-[160px]">
              {u.displayName || '—'}
              {isSelf && <span className="ml-1 text-xs text-indigo-400">(you)</span>}
            </p>
            <p className="text-xs text-gray-400 truncate max-w-[160px]">{u.email}</p>
            <p className="text-xs text-gray-300 mt-0.5">Joined {formatDate(u.joinedAt)}</p>
          </div>
        </div>
      </td>

      {/* Plan + Role */}
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <PlanBadge plan={u.subscription?.plan} status={u.subscription?.status} />
          <RoleBadge isAdmin={isAdminUser} />
          {u.subscription?.currentPeriodEnd && isPro && (
            <p className="text-xs text-gray-400">until {formatDate(u.subscription.currentPeriodEnd)}</p>
          )}
        </div>
      </td>

      {/* Quota */}
      <td className="px-3 py-3">
        {isPro ? (
          <span className="text-green-600 text-xs font-semibold">Unlimited</span>
        ) : (
          <div className="text-xs">
            <p className="text-gray-700 font-medium">
              {lifetimeRemaining} <span className="text-gray-400 font-normal">remaining</span>
            </p>
            <p className="text-gray-400">
              {u.quota?.lifetimeUsed ?? 0}/{u.quota?.lifetimeAllowance ?? 500} used
            </p>
            {/* Mini progress bar */}
            <div className="w-20 bg-gray-100 rounded-full h-1.5 mt-1 overflow-hidden">
              <div
                className={`h-full rounded-full ${lifetimeRemaining === 0 ? 'bg-red-400' : 'bg-amber-400'}`}
                style={{ width: `${Math.min(100, ((u.quota?.lifetimeUsed ?? 0) / (u.quota?.lifetimeAllowance ?? 500)) * 100)}%` }}
              />
            </div>
          </div>
        )}
      </td>

      {/* Activity */}
      <td className="px-3 py-3 text-xs">
        <p className="text-gray-600">{u.stats?.cleanupCount ?? 0} cleanups</p>
        <p className="text-gray-400">{u.stats?.scanCount ?? 0} scans</p>
        {u.stats?.totalBytesFreed > 0 && (
          <p className="text-green-600 font-medium">{formatBytes(u.stats.totalBytesFreed)} freed</p>
        )}
        {u.lastScanAt && (
          <p className="text-gray-300 mt-0.5">Last scan {timeAgo(u.lastScanAt)}</p>
        )}
      </td>

      {/* Last Action */}
      <td className="px-3 py-3 text-xs">
        {u.lastAction ? (
          <div>
            <p className="text-gray-700 font-medium capitalize">
              {u.lastAction.category?.replace(/_/g, ' ') || '—'}
            </p>
            <p className="text-gray-400">{u.lastAction.messageCount} emails</p>
            <p className="text-gray-300 mt-0.5">{timeAgo(u.lastAction.executedAt)}</p>
          </div>
        ) : (
          <span className="text-gray-300">No actions yet</span>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        {error && <p className="text-xs text-red-500 mb-1.5">{error}</p>}

        <div className="flex flex-col gap-1.5">
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

          {/* Reset Quota (free users only) */}
          {!isPro && (
            <div>
              {showQuotaEdit ? (
                <div className="flex items-center gap-1 mt-0.5">
                  <input
                    type="number"
                    value={quotaInput}
                    onChange={e => setQuotaInput(e.target.value)}
                    className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-xs"
                    min={0}
                    max={10000}
                  />
                  <button
                    onClick={resetQuota}
                    disabled={busy}
                    className="text-xs font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setShowQuotaEdit(false)}
                    className="text-xs text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowQuotaEdit(true)}
                  disabled={busy}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors disabled:opacity-50"
                >
                  Edit Quota
                </button>
              )}
            </div>
          )}

          {/* Delete */}
          {!isSelf && (
            <button
              onClick={deleteUser}
              disabled={busy}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              Delete User
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── User Table ───────────────────────────────────────────────────────────────

function UserTable({ title, icon, users, currentUserId, onRefresh }) {
  const [open, setOpen] = useState(true);
  if (users.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{icon}</span>
          <h3 className="font-bold text-gray-800 text-sm">{title}</h3>
          <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2 py-0.5 rounded-full">{users.length}</span>
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50/60 border-b border-gray-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">User</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Plan / Role</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quota</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Activity</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Last Action</th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Manage</th>
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
        api.get('/admin/users', { params: { limit: 500, offset: 0 } }),
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
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }
  if (!isAdmin) return null;

  const filtered = search.trim()
    ? allUsers.filter(u =>
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.displayName?.toLowerCase().includes(search.toLowerCase())
      )
    : allUsers;

  const adminUsers = filtered.filter(u => u.isAdmin);
  const proUsers   = filtered.filter(u => !u.isAdmin && u.subscription?.plan === 'pro' && u.subscription?.status === 'active');
  const freeUsers  = filtered.filter(u => !u.isAdmin && !(u.subscription?.plan === 'pro' && u.subscription?.status === 'active'));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚙️</span>
            <span className="font-bold text-gray-900 text-sm">Admin Dashboard</span>
            <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={load}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors"
            >
              ↻ Refresh
            </button>
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              ← Back to App
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">

        {/* Stats overview */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            {[
              { label: 'Total Users',     value: stats.totalUsers,       color: 'bg-blue-50 text-blue-700',    icon: '👥' },
              { label: 'Pro Subscribers', value: stats.proUsers,         color: 'bg-indigo-50 text-indigo-700', icon: '⭐' },
              { label: 'New This Week',   value: stats.newUsersThisWeek, color: 'bg-teal-50 text-teal-700',    icon: '🆕' },
              { label: 'Scans Done',      value: stats.totalScans,       color: 'bg-purple-50 text-purple-700', icon: '🔍' },
              { label: 'Space Freed',     value: formatBytes(stats.totalBytesFreed), color: 'bg-green-50 text-green-700', icon: '🗑️' },
            ].map(s => (
              <div key={s.label} className={`rounded-2xl p-4 ${s.color}`}>
                <p className="text-xl font-bold">{s.value?.toLocaleString?.() ?? s.value}</p>
                <p className="text-xs font-semibold mt-1 opacity-70">{s.icon} {s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white shadow-sm"
          />
        </div>

        {/* Summary counts */}
        {!loading && (
          <div className="flex gap-4 mb-5 text-xs text-gray-400">
            <span>{filtered.length} users total</span>
            {search && <span className="text-indigo-500">filtered from {allUsers.length}</span>}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <UserTable
              title="Admins"
              icon="👑"
              users={adminUsers}
              currentUserId={user?.id}
              onRefresh={load}
            />
            <UserTable
              title="Pro Subscribers"
              icon="⭐"
              users={proUsers}
              currentUserId={user?.id}
              onRefresh={load}
            />
            <UserTable
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
