// src/api/client.js
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

let isRefreshing = false;
let failedQueue  = [];

function processQueue(error, token = null) {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
}

api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && error.response?.data?.code === 'TOKEN_EXPIRED') {
      if (isRefreshing) {
        return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }))
          .then(token => { if (token) original.headers.Authorization = `Bearer ${token}`; return api(original); });
      }
      original._retry = true;
      isRefreshing    = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const res = await axios.post(`${API_URL}/auth/refresh`, { refresh_token: refreshToken }, { withCredentials: true });
        const { accessToken, refreshToken: newRT } = res.data;
        if (accessToken) {
          localStorage.setItem('access_token', accessToken);
          if (newRT) localStorage.setItem('refresh_token', newRT);
          original.headers.Authorization = `Bearer ${accessToken}`;
          processQueue(null, accessToken);
        }
        return api(original);
      } catch (e) {
        processQueue(e, null);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        window.location.href = '/login?session_expired=true';
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  getGoogleAuthUrl: (stateOrForce, force = false) => {
    // Supports two call signatures:
    //   getGoogleAuthUrl('extension')       → ?state=extension
    //   getGoogleAuthUrl(true)              → ?force=true  (force consent, called from useAuth)
    //   getGoogleAuthUrl('ext', true)       → ?state=ext&force=true
    const isForceOnly = stateOrForce === true;
    const state       = isForceOnly ? '' : (stateOrForce || '');
    const forceFlag   = isForceOnly || force;
    const params      = new URLSearchParams();
    if (state)      params.set('state', state);
    if (forceFlag)  params.set('force', 'true');
    const qs = params.toString();
    return api.get(`/auth/google${qs ? `?${qs}` : ''}`);
  },
  getMe:         () => api.get('/auth/me'),
  logout:        () => api.post('/auth/logout'),
  deleteAccount: () => api.delete('/auth/account'),
  refresh:       (rt) => api.post('/auth/refresh', { refresh_token: rt }),
};

export const scanApi = {
  startScan:         (scanDepth = '12months') => api.post('/scan/start', { scanDepth }),
  startCustomScan:   (params)                 => api.post('/scan/start-custom', params),
  previewCustomScan: (params)                 => api.post('/scan/preview-custom', params),
  getScan:           (scanId)                 => api.get(`/scan/${scanId}`),
  getLatestScan:     ()                       => api.get('/scan/user/latest'),
  getScanHistory:    ()                       => api.get('/scan/user/history'),
};

export const cleanupApi = {
  // Large cleanups (hundreds/thousands of emails) can take longer than default 30s.
  execute:    (payload)          => api.post('/cleanup/execute', payload, { timeout: 180000 }),
  getJob:     (jobId)            => api.get(`/cleanup/job/${jobId}`),
  // Large undo can also be long-running for huge batches.
  undo:       (actionId)         => api.post(`/cleanup/undo/${actionId}`, {}, { timeout: 600000 }),
  // Round 3: accepts { limit, offset } for pagination
  getHistory: (params = {})      => api.get('/cleanup/history', { params }),
  getQuota:   ()                 => api.get('/cleanup/quota'),
};

export const subscriptionApi = {
  createCheckout: () => api.post('/subscription/checkout'),
  createPortal:   () => api.post('/subscription/portal'),
  getStatus:      () => api.get('/subscription/status'),
};

export const automationApi = {
  listPlaybooks:   ()               => api.get('/automation/playbooks'),
  createPlaybook:  (payload)        => api.post('/automation/playbooks', payload),
  updatePlaybook:  (id, payload)    => api.patch(`/automation/playbooks/${id}`, payload),
  deletePlaybook:  (id)             => api.delete(`/automation/playbooks/${id}`),
  previewPlaybook: (id)             => api.post(`/automation/playbooks/${id}/preview`),
  runPlaybook:     (id)             => api.post(`/automation/playbooks/${id}/run`),
  listRuns:        (limit = 20)     => api.get('/automation/runs', { params: { limit } }),
  getDomainInsights: ()             => api.get('/automation/insights/domains'),
};

export default api;
