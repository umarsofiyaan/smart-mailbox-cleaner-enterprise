// src/hooks/useAuth.js
import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Track if onboarding should show (new users)
  const [isNewUser, setIsNewUser] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Check if tokens are in URL (from OAuth callback)
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const newUser = params.get('new_user') === 'true';

    if (accessToken && refreshToken) {
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);
      if (newUser) setIsNewUser(true);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, []);

  async function checkAuth() {
    // If no tokens at all, skip the network call
    const hasToken = localStorage.getItem('access_token') || localStorage.getItem('refresh_token');
    if (!hasToken) {
      setLoading(false);
      return;
    }

    try {
      const response = await authApi.getMe();
      setUser(response.data);
    } catch {
      // Try to refresh before giving up
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        if (refreshToken) {
          const refreshRes = await authApi.refresh(refreshToken);
          const { accessToken, refreshToken: newRefresh } = refreshRes.data;
          if (accessToken) {
            localStorage.setItem('access_token', accessToken);
            if (newRefresh) localStorage.setItem('refresh_token', newRefresh);
            // Retry auth check
            const retryRes = await authApi.getMe();
            setUser(retryRes.data);
            return;
          }
        }
      } catch {
        // Refresh also failed — user needs to log in again
      }
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {}
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }

  async function deleteAccount() {
    await authApi.deleteAccount();
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }

  function markOnboardingComplete() {
    setIsNewUser(false);
  }

  return (
    <AuthContext.Provider value={{ user, loading, error, isNewUser, logout, deleteAccount, refetch: checkAuth, markOnboardingComplete }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
