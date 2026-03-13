import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token = null) {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token));
  failedQueue = [];
}

function clearStoredTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
}

api.interceptors.response.use(
  res => res,
  async error => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && error.response?.data?.code === 'TOKEN_EXPIRED') {
      if (isRefreshing) {
        return new Promise((resolve, reject) => failedQueue.push({ resolve, reject }))
          .then(() => api(original));
      }

      original._retry = true;
      isRefreshing = true;

      try {
        await axios.post(`${API_URL}/auth/refresh`, {}, { withCredentials: true });
        processQueue(null, true);
        return api(original);
      } catch (e) {
        processQueue(e, null);
        clearStoredTokens();
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
    const isForceOnly = stateOrForce === true;
    const state = isForceOnly ? '' : (stateOrForce || '');
    const forceFlag = isForceOnly || force;
    const params = new URLSearchParams();
    if (state) params.set('state', state);
    if (forceFlag) params.set('force', 'true');
    const qs = params.toString();
    return api.get(`/auth/google${qs ? `?${qs}` : ''}`, { timeout: 120000 });
  },
  getMe: () => api.get('/auth/me', { timeout: 120000 }),
  logout: () => api.post('/auth/logout'),
  deleteAccount: () => api.delete('/auth/account'),
  refresh: () => api.post('/auth/refresh', {}, { timeout: 120000 }),
  getGoogleConnectUrl: () => api.get('/auth/google/connect', { timeout: 120000 }),
};

export const scanApi = {
  startScan: (scanDepth = '12months', mailboxId = null) => api.post('/scan/start', { scanDepth, mailboxId }),
  startCustomScan: (params) => api.post('/scan/start-custom', params),
  previewCustomScan: (params) => api.post('/scan/preview-custom', params),
  getScan: (scanId) => api.get(`/scan/${scanId}`),
  getLatestScan: (mailboxId = null) => api.get('/scan/user/latest', { params: mailboxId ? { mailboxId } : {} }),
  getScanHistory: (mailboxId = null) => api.get('/scan/user/history', { params: mailboxId ? { mailboxId } : {} }),
};

export const cleanupApi = {
  execute: (payload) => api.post('/cleanup/execute', payload, { timeout: 180000 }),
  getJob: (jobId) => api.get(`/cleanup/job/${jobId}`),
  undo: (actionId) => api.post(`/cleanup/undo/${actionId}`, {}, { timeout: 600000 }),
  getHistory: (params = {}) => api.get('/cleanup/history', { params }),
  getQuota: () => api.get('/cleanup/quota'),
};

export const subscriptionApi = {
  getPricing: () => api.get('/subscription/pricing'),
  createCheckout: (payload = {}) => api.post('/subscription/checkout', payload),
  verifyPayment: (payload) => api.post('/subscription/verify', payload),
  purchase: (planType) => api.post('/subscription/purchase', { plan_type: planType }),
  createPortal: () => api.post('/subscription/portal'),
  getStatus: () => api.get('/subscription/status'),
  cancel: () => api.post('/subscription/cancel'),
};

export const userApi = {
  getQuota: () => api.get('/user/quota'),
  getGuardian: () => api.get('/user/guardian'),
  updateGuardian: (payload) => api.patch('/user/guardian', payload),
  getMailboxes: () => api.get('/user/mailboxes'),
  setPrimaryMailbox: (mailboxId) => api.patch(`/user/mailboxes/${mailboxId}/primary`),
  deleteMailbox: (mailboxId) => api.delete(`/user/mailboxes/${mailboxId}`),
  getNewsletterSubscriptions: () => api.get('/user/newsletter/subscriptions'),
  bulkUnsubscribe: (payload) => api.post('/user/unsubscribe/bulk', payload),
  blockSender: (payload) => api.post('/user/senders/block', payload),
  getLatestHealth: () => api.get('/user/health/latest'),
};

export const automationApi = {
  listPlaybooks: () => api.get('/automation/playbooks'),
  createPlaybook: (payload) => api.post('/automation/playbooks', payload),
  updatePlaybook: (id, payload) => api.patch(`/automation/playbooks/${id}`, payload),
  deletePlaybook: (id) => api.delete(`/automation/playbooks/${id}`),
  previewPlaybook: (id) => api.post(`/automation/playbooks/${id}/preview`),
  runPlaybook: (id) => api.post(`/automation/playbooks/${id}/run`),
  listRuns: (limit = 20) => api.get('/automation/runs', { params: { limit } }),
  getDomainInsights: () => api.get('/automation/insights/domains'),
};

export default api;
