import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import api from '../api/client';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function resolveEffectivePlan(user) {
  if (user?.is_power_active) return 'power';
  if (user?.plan_type === 'starter' || user?.plan_type === 'pro') return user.plan_type;
  return 'free';
}

function PlanBadge({ user }) {
  const plan = resolveEffectivePlan(user);
  const cls = {
    free: 'bg-gray-100 text-gray-600',
    starter: 'bg-blue-100 text-blue-700',
    pro: 'bg-indigo-100 text-indigo-700',
    power: 'bg-emerald-100 text-emerald-700',
  }[plan] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${cls}`}>
      {plan.charAt(0).toUpperCase() + plan.slice(1)}
    </span>
  );
}

function RoleBadge({ isAdmin }) {
  return isAdmin
    ? <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">Admin</span>
    : <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">User</span>;
}

function UserRow({ u, currentUserId, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [planInput, setPlanInput] = useState(resolveEffectivePlan(u));
  const [showCreditsEdit, setShowCreditsEdit] = useState(false);
  const [creditsInput, setCreditsInput] = useState(Math.max(0, Number(u.delete_credits || 0)));

  const isSelf = u.id === currentUserId;
  const isAdminUser = !!u.is_admin;
  const plan = resolveEffectivePlan(u);
  const isPower = plan === 'power';

  const deleteCredits = Math.max(0, Number(u.delete_credits || 0));
  const deletedTotal = Math.max(0, Number(u.emails_deleted_total || 0));
  const scanCount = Math.max(0, Number(u.scan_count || 0));
  const cleanupCount = Math.max(0, Number(u.cleanup_count || 0));
  const displayName = u.display_name || u.email?.split('@')[0] || '-';

  async function applyPlan() {
    if (!confirm(`Set plan for ${u.email} to ${planInput}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/users/${u.id}/subscription`, {
        plan: planInput,
        status: planInput === 'free' ? 'canceled' : 'active',
      });
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update plan.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin() {
    if (isSelf) return;
    if (!confirm(`${isAdminUser ? 'Remove admin role from' : 'Grant admin role to'} ${u.email}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/users/${u.id}/role`, { isAdmin: !isAdminUser });
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update role.');
    } finally {
      setBusy(false);
    }
  }

  async function saveCredits() {
    if (!confirm(`Set delete credits for ${u.email} to ${creditsInput}?`)) return;
    setBusy(true);
    setError('');
    try {
      await api.patch(`/admin/users/${u.id}/quota`, { deleteCredits: Number(creditsInput || 0) });
      setShowCreditsEdit(false);
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to update credits.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser() {
    if (isSelf) return;
    if (!confirm(`Delete ${u.email}? This revokes all sessions and soft-deletes account.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.delete(`/admin/users/${u.id}`);
      onRefresh();
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to delete user.');
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50/40 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          {u.avatar_url
            ? <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
            : <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
                {displayName[0]?.toUpperCase()}
              </div>
          }
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
              {displayName}
              {isSelf && <span className="ml-1 text-xs text-indigo-400">(you)</span>}
            </p>
            <p className="text-xs text-gray-400 truncate max-w-[180px]">{u.email}</p>
            <p className="text-xs text-gray-300 mt-0.5">Joined {formatDate(u.created_at)}</p>
          </div>
        </div>
      </td>

      <td className="px-3 py-3">
        <div className="flex flex-col gap-1.5">
          <PlanBadge user={u} />
          <RoleBadge isAdmin={isAdminUser} />
          {isPower && (u.plan_expiry || u.current_period_end) && (
            <p className="text-xs text-gray-400">until {formatDate(u.plan_expiry || u.current_period_end)}</p>
          )}
        </div>
      </td>

      <td className="px-3 py-3">
        {isPower ? (
          <span className="text-green-600 text-xs font-semibold">Unlimited</span>
        ) : (
          <div className="text-xs">
            <p className="text-gray-700 font-medium">{deleteCredits.toLocaleString()} remaining</p>
            <p className="text-gray-400">{deletedTotal.toLocaleString()} deleted total</p>
          </div>
        )}
      </td>

      <td className="px-3 py-3 text-xs">
        <p className="text-gray-600">{cleanupCount} cleanups</p>
        <p className="text-gray-400">{scanCount} scans</p>
      </td>

      <td className="px-3 py-3 text-xs text-gray-300">-</td>

      <td className="px-3 py-3">
        {error && <p className="text-xs text-red-500 mb-1.5">{error}</p>}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            <select
              value={planInput}
              onChange={(e) => setPlanInput(e.target.value)}
              disabled={busy}
              className="text-xs border border-gray-200 rounded-lg px-1.5 py-1 bg-white"
            >
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="pro">Pro</option>
              <option value="power">Power</option>
            </select>
            <button
              onClick={applyPlan}
              disabled={busy}
              className="text-xs font-semibold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              Apply
            </button>
          </div>

          {!isSelf && (
            <button
              onClick={toggleAdmin}
              disabled={busy}
              className={`text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-50 ${
                isAdminUser ? 'bg-orange-50 text-orange-700 hover:bg-orange-100' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
              }`}
            >
              {isAdminUser ? 'Remove Admin' : 'Make Admin'}
            </button>
          )}

          {!isPower && (
            showCreditsEdit ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={creditsInput}
                  onChange={(e) => setCreditsInput(e.target.value)}
                  className="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs"
                  min={0}
                />
                <button
                  onClick={saveCredits}
                  disabled={busy}
                  className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg disabled:opacity-50"
                >
                  Save
                </button>
                <button onClick={() => setShowCreditsEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">x</button>
              </div>
            ) : (
              <button
                onClick={() => setShowCreditsEdit(true)}
                disabled={busy}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
              >
                Edit Credits
              </button>
            )
          )}

          {!isSelf && (
            <button
              onClick={deleteUser}
              disabled={busy}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              Delete User
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function UserTable({ title, users, currentUserId, onRefresh }) {
  if (!users.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
      <div className="px-5 py-3.5 border-b border-gray-50">
        <h3 className="font-bold text-gray-800 text-sm">{title} <span className="text-gray-400 font-medium">({users.length})</span></h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50/60 border-b border-gray-100">
              {['USER', 'PLAN / ROLE', 'QUOTA', 'ACTIVITY', 'LAST ACTION', 'MANAGE'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} u={u} currentUserId={currentUserId} onRefresh={onRefresh} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [deletedUsers, setDeletedUsers] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    async function checkAdmin() {
      try {
        const res = await api.get('/auth/me');
        if (res.data.isAdmin) setIsAdmin(true);
        else navigate('/dashboard');
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
      const [statsRes, usersRes, deletedRes, auditRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/users', { params: { limit: 500, offset: 0 } }),
        api.get('/admin/users', { params: { limit: 200, offset: 0, includeDeleted: 'true' } }),
        api.get('/admin/audit', { params: { limit: 50, offset: 0 } }),
      ]);
      setStats(statsRes.data || null);
      setAllUsers(usersRes.data?.users || []);
      setDeletedUsers((deletedRes.data?.users || []).filter((u) => u.deleted_at));
      setAuditLog(auditRes.data?.log || []);
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
    ? allUsers.filter((u) =>
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.display_name?.toLowerCase().includes(search.toLowerCase()))
    : allUsers;

  const adminUsers = filtered.filter((u) => u.is_admin);
  const paidUsers = filtered.filter((u) => !u.is_admin && resolveEffectivePlan(u) !== 'free');
  const freeUsers = filtered.filter((u) => !u.is_admin && resolveEffectivePlan(u) === 'free');

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="font-bold text-gray-900 text-sm">Admin Dashboard</span>
            <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">Admin</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={load} disabled={loading} className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50">
              Refresh
            </button>
            <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-500 hover:text-gray-700">
              Back to App
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
            <div className="rounded-2xl p-4 bg-blue-50 text-blue-700"><p className="text-xl font-bold">{stats.totalUsers}</p><p className="text-xs font-semibold mt-1 opacity-70">Total Users</p></div>
            <div className="rounded-2xl p-4 bg-indigo-50 text-indigo-700"><p className="text-xl font-bold">{stats.proUsers}</p><p className="text-xs font-semibold mt-1 opacity-70">Paid Users</p></div>
            <div className="rounded-2xl p-4 bg-teal-50 text-teal-700"><p className="text-xl font-bold">{stats.newUsersThisWeek ?? 0}</p><p className="text-xs font-semibold mt-1 opacity-70">New This Week</p></div>
            <div className="rounded-2xl p-4 bg-purple-50 text-purple-700"><p className="text-xl font-bold">{stats.totalScans}</p><p className="text-xs font-semibold mt-1 opacity-70">Scans Done</p></div>
            <div className="rounded-2xl p-4 bg-green-50 text-green-700"><p className="text-xl font-bold">{formatBytes(stats.totalBytesFreed)}</p><p className="text-xs font-semibold mt-1 opacity-70">Space Freed</p></div>
          </div>
        )}

        <div className="mb-5">
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white shadow-sm"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <UserTable title="Admins" users={adminUsers} currentUserId={user?.id} onRefresh={load} />
            <UserTable title="Paid Users" users={paidUsers} currentUserId={user?.id} onRefresh={load} />
            <UserTable title="Free Users" users={freeUsers} currentUserId={user?.id} onRefresh={load} />

            {deletedUsers.length > 0 && (
              <div className="bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden mb-6">
                <div className="px-5 py-3.5 border-b border-red-50">
                  <h3 className="font-bold text-gray-800 text-sm">Deleted Users <span className="text-red-500">({deletedUsers.length})</span></h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-red-50/40 border-b border-red-50">
                        {['USER', 'EMAIL', 'JOINED', 'DELETED ON'].map((h) => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {deletedUsers.map((u) => (
                        <tr key={u.id} className="border-b border-gray-50 opacity-80">
                          <td className="px-4 py-3 text-sm text-gray-700">{u.display_name || '-'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{u.email}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatDate(u.created_at)}</td>
                          <td className="px-4 py-3 text-xs text-red-500">{formatDate(u.deleted_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-50">
                <h3 className="font-bold text-gray-800 text-sm">Admin Audit Log <span className="text-gray-400">({auditLog.length})</span></h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/60 border-b border-gray-100">
                      {['WHEN', 'ADMIN', 'ACTION', 'TARGET USER', 'DETAIL'].map((h) => (
                        <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map((a) => (
                      <tr key={a.id} className="border-b border-gray-50">
                        <td className="px-4 py-3 text-xs text-gray-500">{formatDate(a.created_at)}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{a.admin_email || '-'}</td>
                        <td className="px-4 py-3 text-xs font-medium text-indigo-600">{a.action}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{a.target_email || '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{JSON.stringify(a.detail || {})}</td>
                      </tr>
                    ))}
                    {auditLog.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No audit records.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

