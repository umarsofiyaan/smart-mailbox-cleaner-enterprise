// src/pages/Login.jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuth } from '../hooks/useAuth.jsx';

export default function Login() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const errorParam = searchParams.get('error');
  const sessionExpired = searchParams.get('session_expired');

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (errorParam === 'oauth_denied') setErrorMessage('Google sign-in was cancelled.');
    else if (errorParam === 'auth_failed') setErrorMessage('Authentication failed. Please try again.');
    else if (errorParam === 'no_refresh_token') setErrorMessage('Please revoke access in Google settings and try again.');
    else if (sessionExpired) setErrorMessage('Your session expired. Please sign in again.');
  }, [errorParam, sessionExpired]);

  async function handleGoogleLogin() {
    setIsConnecting(true);
    setErrorMessage('');

    try {
      const response = await authApi.getGoogleAuthUrl();
      window.location.href = response.data.url;
    } catch {
      setErrorMessage('Failed to connect to Google. Please try again.');
      setIsConnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-3xl">📬</span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Smart Mailbox Cleaner</h1>
          <p className="text-gray-500 mt-2">Free up Gmail storage — safely, in minutes</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
          {errorMessage && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-6">
              <p className="text-sm text-red-700">{errorMessage}</p>
            </div>
          )}

          <button
            onClick={handleGoogleLogin}
            disabled={isConnecting}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 hover:border-brand-300 hover:bg-brand-50 text-gray-700 font-semibold py-4 px-6 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {isConnecting ? (
              <div className="w-5 h-5 border-2 border-gray-300 border-t-brand-600 rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            {isConnecting ? 'Connecting to Google…' : 'Continue with Google'}
          </button>

          {/* Features */}
          <div className="mt-8 space-y-3">
            {[
              { icon: '🔒', text: 'We never read your email content' },
              { icon: '🗑️', text: 'Emails moved to Trash, never deleted permanently' },
              { icon: '↩️', text: 'Undo any cleanup within 30 days' },
              { icon: '📊', text: 'See exactly how much space you can free' },
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-lg">{feature.icon}</span>
                <p className="text-sm text-gray-600">{feature.text}</p>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-400 text-center mt-6">
            By continuing, you agree to our{' '}
            <a href="/privacy" className="underline hover:text-gray-600">Privacy Policy</a>
            {' '}and{' '}
            <a href="/terms" className="underline hover:text-gray-600">Terms of Service</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
