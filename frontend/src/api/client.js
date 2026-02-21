// src/api/client.js
// Axios client with automatic token refresh and retry on 401.
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Send cookies for web dashboard
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Track refresh state to avoid multiple simultaneous refresh calls
let isRefreshing = false;
let failedQueue = [];

function processQueue(error, token = null) {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

// Request interceptor — attach JWT from localStorage (extension) or rely on cookies (web)
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — auto-refresh on 401
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      if (error.response?.data?.code === 'TOKEN_EXPIRED') {
        if (isRefreshing) {
          // Queue this request until refresh completes
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then(token => {
            if (token) original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          });
        }

        original._retry = true;
        isRefreshing = true;

        try {
          const refreshToken = localStorage.getItem('refresh_token');
          const response = await axios.post(
            `${API_URL}/auth/refresh`,
            { refresh_token: refreshToken },
            { withCredentials: true }
          );

          const { accessToken, refreshToken: newRefreshToken } = response.data;

          if (accessToken) {
            localStorage.setItem('access_token', accessToken);
            if (newRefreshToken) localStorage.setItem('refresh_token', newRefreshToken);
            original.headers.Authorization = `Bearer ${accessToken}`;
            processQueue(null, accessToken);
          }

          return api(original);
        } catch (refreshError) {
          processQueue(refreshError, null);
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/login?session_expired=true';
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }
    }

    return Promise.reject(error);
  }
);

// Convenience helpers
export const authApi = {
  getGoogleAuthUrl: (state) => api.get(`/auth/google${state ? `?state=${state}` : ''}`),
  getMe: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  deleteAccount: () => api.delete('/auth/account'),
  refresh: (refreshToken) => api.post('/auth/refresh', { refresh_token: refreshToken }),
};

export const scanApi = {
  startScan: (scanDepth = '12months') => api.post('/scan/start', { scanDepth }),
  getScan: (scanId) => api.get(`/scan/${scanId}`),
  getLatestScan: () => api.get('/scan/user/latest'),
  getScanHistory: () => api.get('/scan/user/history'),
};

export const cleanupApi = {
  execute: (payload) => api.post('/cleanup/execute', payload),
  undo: (actionId) => api.post(`/cleanup/undo/${actionId}`),
  getHistory: () => api.get('/cleanup/history'),
  getQuota: () => api.get('/cleanup/quota'),
};

export const subscriptionApi = {
  createCheckout: () => api.post('/subscription/checkout'),
  createPortal: () => api.post('/subscription/portal'),
  getStatus: () => api.get('/subscription/status'),
};

export default api;
