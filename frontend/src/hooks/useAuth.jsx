import { useState, useEffect, createContext, useContext, useRef } from 'react';
import { authApi } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const params = new URLSearchParams(window.location.search);
    const newUser = params.get('new_user') === 'true';

    const forceConsent = params.get('force_consent') === 'true';
    if (forceConsent) {
      clearTokens();
      authApi.getGoogleAuthUrl(true).then(res => {
        window.location.href = res.data.url;
      }).catch(() => {
        setLoading(false);
      });
      return;
    }

    if (newUser) {
      setIsNewUser(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    checkAuth();
  }, []);

  function clearTokens() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    setUser(null);
  }

  async function checkAuth() {
    try {
      const response = await authApi.getMe();
      setUser(response.data);
    } catch (err) {
      const errorCode = err?.response?.data?.code;

      if (errorCode === 'ACCOUNT_DELETED') {
        clearTokens();
        setLoading(false);
        return;
      }

      try {
        const storedRefresh = localStorage.getItem('refresh_token');
        const refreshRes = await authApi.refresh(storedRefresh);
        const { accessToken, refreshToken: newRefresh } = refreshRes.data || {};

        if (accessToken) {
          localStorage.setItem('access_token', accessToken);
        }
        if (newRefresh) {
          localStorage.setItem('refresh_token', newRefresh);
        }

        const retryRes = await authApi.getMe();
        setUser(retryRes.data);
        return;
      } catch (refreshErr) {
        const refreshCode = refreshErr?.response?.data?.code;

        if (refreshCode === 'ACCOUNT_DELETED') {
          clearTokens();
          setLoading(false);
          return;
        }
      }

      clearTokens();
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {}
    clearTokens();
  }

  async function deleteAccount() {
    await authApi.deleteAccount();
    clearTokens();
  }

  function markOnboardingComplete() {
    setIsNewUser(false);
  }

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      error,
      isNewUser,
      logout,
      deleteAccount,
      refetch: checkAuth,
      markOnboardingComplete,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
