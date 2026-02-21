// src/pages/Admin.jsx
// Admin dashboard for managing users, subscriptions, and quotas.
// Only visible to users with is_admin = true.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import api from '../api/client';

export default function Admin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editingQuota, setEditingQuota] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [checking, setChecking] = useState(true);

  // Check if user is admin
  useEffect(() => {
    async function checkAdmin() {
      try {
        const response = await api.get('/auth/me');
        if (response.data.isAdmin) {
          setIsAdmin(true);
          loadStats();
          loadUsers();
        } else {
          // Not an admin, redirect back to dashboard
          navigate('/dashboard');
        }
      } catch (err) {
        console.error('Failed to check admin status', err);
        navigate('/dashboard');
      } finally {
        setChecking(false);
      }
    }
    checkAdmin();
  }, [navigate]);

  // Load stats and users
  useEffect(() => {
    if (isAdmin) {
      loadStats();
      loadUsers();
    }
  }, [search, limit, offset, isAdmin]);

  async function loadStats() {
    try {
      const response = await api.get('/admin/stats');
      setStats(response.data);
    } catch (err) {
      console.error('Failed to load stats', err);
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const response = await api.get('/admin/users', {
        params: { search, limit, offset },
      });
      setUsers(response.data.users);
    } catch (err) {
      console.error('Failed to load users', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleFlipPlan(userId, currentPlan) {
    const newPlan = currentPlan === 'pro' ? 'free' : 'pro';
    try {
      await api.patch(`/admin/users/${userId}/subscription`, {
        plan: newPlan,
        status: 'active',
      });
      loadUsers();
      loadStats();
    } catch (err) {
      alert(`Failed to update plan: ${err.response?.data?.error || err.message}`);
    }
  }

  async function handleSaveQuota(userId) {
    try {
      await api.patch(`/admin/users/${userId}/quota`, editingQuota);
      setEditingUserId(null);
      setEditingQuota({});
      loadUsers();
    } catch (err) {
      alert(`Failed to save quota: ${err.response?.data?.error || err.message}`);
    }
  }

  async function handleDeleteUser(userId, email) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;

    try {
      await api.delete(`/admin/users/${userId}`);
      loadUsers();
      loadStats();
    } catch (err) {
      alert(`Failed to delete user: ${err.response?.data?.error || err.message}`);
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Show loading while checking admin status
  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  // If not admin, don't render anything (will redirect)
  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚙️</span>
            <span className="font-bold text-gray-900">Admin Dashboard</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Back to Dashboard
            </button>
            <button
              onClick={logout}
              className="text-sm text-red-500 hover:text-red-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-gray-500 text-sm font-medium mb-1">Total Users</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalUsers}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-gray-500 text-sm font-medium mb-1">Pro Subscribers</p>
              <p className="text-3xl font-bold text-brand-600">{stats.proUsers}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-gray-500 text-sm font-medium mb-1">Total Scans</p>
              <p className="text-3xl font-bold text-gray-900">{stats.totalScans}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-gray-500 text-sm font-medium mb-1">Space Freed</p>
              <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.totalBytesFreed)}</p>
            </div>
          </div>
        )}

        {/* Search & Filter */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-6">
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Plan</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Quota Status</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Stats</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{u.displayName}</p>
                      <p className="text-xs text-gray-500">{u.email}</p>
                      {u.isAdmin && <p className="text-xs text-brand-600 font-semibold">👑 Admin</p>}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleFlipPlan(u.id, u.subscription.plan)}
                      className={`px-3 py-1 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                        u.subscription.plan === 'pro'
                          ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {u.subscription.plan}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-gray-600">
                      {u.subscription.isPro ? (
                        <span className="text-green-600 font-medium">Unlimited (Pro)</span>
                      ) : (
                        <>
                          <p>Lifetime: {u.quota.lifetimeUsed}/{u.quota.lifetimeAllowance}</p>
                          <p>Daily: {u.quota.dailyUsed}/{u.quota.dailyAllowance}</p>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-xs text-gray-600">
                    <p>{u.stats.scanCount} scans</p>
                    <p>{u.stats.cleanupCount} cleanups</p>
                  </td>
                  <td className="px-6 py-4">
                    {editingUserId === u.id ? (
                      <div className="space-y-2 text-xs">
                        <label className="block">
                          Lifetime Allowance:
                          <input
                            type="number"
                            value={editingQuota.lifetimeAllowance ?? u.quota.lifetimeAllowance}
                            onChange={(e) =>
                              setEditingQuota({ ...editingQuota, lifetimeAllowance: parseInt(e.target.value) })
                            }
                            className="w-full px-2 py-1 border border-gray-200 rounded mt-1"
                          />
                        </label>
                        <label className="block">
                          Lifetime Used:
                          <input
                            type="number"
                            value={editingQuota.lifetimeUsed ?? u.quota.lifetimeUsed}
                            onChange={(e) =>
                              setEditingQuota({ ...editingQuota, lifetimeUsed: parseInt(e.target.value) })
                            }
                            className="w-full px-2 py-1 border border-gray-200 rounded mt-1"
                          />
                        </label>
                        <label className="block">
                          Daily Allowance:
                          <input
                            type="number"
                            value={editingQuota.dailyAllowance ?? u.quota.dailyAllowance}
                            onChange={(e) =>
                              setEditingQuota({ ...editingQuota, dailyAllowance: parseInt(e.target.value) })
                            }
                            className="w-full px-2 py-1 border border-gray-200 rounded mt-1"
                          />
                        </label>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => handleSaveQuota(u.id)}
                            className="flex-1 bg-green-600 text-white px-2 py-1 rounded text-xs font-medium hover:bg-green-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => { setEditingUserId(null); setEditingQuota({}); }}
                            className="flex-1 bg-gray-300 text-gray-700 px-2 py-1 rounded text-xs font-medium hover:bg-gray-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingUserId(u.id);
                            setEditingQuota({});
                          }}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium hover:bg-blue-200"
                        >
                          Edit Quota
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id, u.email)}
                          className="px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {users.length === 0 && !loading && (
            <div className="p-8 text-center text-gray-500">
              No users found.
            </div>
          )}

          {loading && (
            <div className="p-8 text-center text-gray-400">
              Loading users...
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Showing {offset + 1} - {offset + users.length}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={users.length < limit}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </main>
    </div>
  );
}
