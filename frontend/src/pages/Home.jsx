import { Link } from 'react-router-dom';

// src/pages/Home.jsx
// PUBLIC landing page - no auth required.
// This fixes Google's issues:
//   1. Shows privacy policy link prominently (Google can crawl it)
//   2. Is NOT behind a login wall (/ shows this page, not /dashboard)
//   3. Describes what the app does clearly for Google's review

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { authApi } from '../api/client';

export default function Home() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  // If already logged in, go straight to dashboard
  useEffect(() => {
    if (!loading && user) navigate('/dashboard', { replace: true });
  }, [user, loading, navigate]);

  async function handleGetStarted() {
    setIsConnecting(true);
    setConnectError('');
    try {
      const res = await authApi.getGoogleAuthUrl();
      window.location.href = res.data.url;
    } catch {
      setConnectError('Could not reach the server. If this is your first visit, wait up to 60 seconds and try again.');
      setIsConnecting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="w-7 h-7 border-3 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900 text-sm">Smart Mailbox Cleaner</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/privacy-policy" className="text-sm text-gray-500 hover:text-gray-900">Privacy Policy</Link>
            <Link to="/terms-of-service" className="text-sm text-gray-500 hover:text-gray-900">Terms</Link>
            <button
              onClick={handleGetStarted}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {isConnecting ? 'Connecting...' : 'Sign in'}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
          Free to start - No credit card needed
        </div>

        <h1 className="text-5xl font-bold text-gray-900 leading-tight mb-5">
          Free up Gmail storage<br/>
          <span className="text-blue-600">safely, in minutes</span>
        </h1>

        <p className="text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
          Smart Mailbox Cleaner scans your Gmail metadata to find large attachments,
          old promotions, and social clutter - then lets you clean everything with one click.
          We <strong className="text-gray-700">never read your email content</strong>.
        </p>

        <button
          onClick={handleGetStarted}
          disabled={isConnecting}
          className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg px-8 py-4 rounded-xl shadow-lg shadow-blue-200 transition-all hover:shadow-xl hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
        >
          {isConnecting ? (
            <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="white" fillOpacity=".8" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="white" fillOpacity=".8" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="white" fillOpacity=".8" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="white" fillOpacity=".8" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {isConnecting ? 'Connecting to Google...' : 'Get started free with Google'}
        </button>

        <p className="text-sm text-gray-400 mt-4">
          5,000 free cleanup credits included - Undo any action within 30 days
        </p>
        {isConnecting && (
          <p className="text-sm text-blue-600 mt-3">
            Waking up server... first visit can take up to 60 seconds.
          </p>
        )}
        {connectError && (
          <p className="text-sm text-red-600 mt-3">{connectError}</p>
        )}
      </section>

      {/* ── Trust bar ───────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-gray-50 py-6">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: '🔒', title: 'Never reads content', desc: 'We only access metadata - size, labels, dates' },
              { icon: '🗑️', title: 'Trash, not delete', desc: 'Emails moved to Trash. Gmail purges after 30 days' },
              { icon: '↩️', title: '30-day undo', desc: 'Restore any cleanup from your dashboard' },
              { icon: '🔐', title: 'Google OAuth', desc: 'Sign in securely. Revoke access anytime' },
            ].map((f, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <span className="text-2xl">{f.icon}</span>
                <p className="font-semibold text-gray-900 text-sm">{f.title}</p>
                <p className="text-gray-500 text-xs leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">How it works</h2>
        <div className="grid md:grid-cols-3 gap-10">
          {[
            {
              step: '1',
              title: 'Connect your Gmail',
              desc: 'Sign in with Google. We request the minimum permissions needed - read metadata and move to Trash. We never read email content.',
            },
            {
              step: '2',
              title: 'Scan & categorise',
              desc: 'We scan your Gmail metadata in seconds and group emails into categories: large attachments, old promos, social notifications, and more.',
            },
            {
              step: '3',
              title: 'Clean with one click',
              desc: 'Review the suggestions and move entire categories to Trash. Changed your mind? Undo the action from your dashboard within 30 days.',
            },
          ].map((s, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center">
                {s.step}
              </div>
              <h3 className="font-bold text-gray-900">{s.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Gmail API scope disclosure (required by Google) ──────────────── */}
      <section className="bg-blue-50 border border-blue-100 rounded-2xl max-w-5xl mx-auto mx-6 px-8 py-10 mb-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">📋 Google API Permissions we request</h2>
          <p className="text-sm text-gray-600 mb-4">
            We request only the permissions necessary to provide the service. You can revoke access at any time from{' '}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              Google Account Permissions
            </a>.
          </p>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              {
                scope: 'gmail.readonly',
                purpose: 'Read email metadata (size, labels, dates) to find emails using storage. We never read email body content.',
              },
              {
                scope: 'gmail.modify',
                purpose: 'Move selected emails to Trash at your explicit request, and restore them when you undo.',
              },
              {
                scope: 'drive.metadata.readonly',
                purpose: 'Check your Google storage quota to show how much Gmail storage you are using.',
              },
            ].map((p, i) => (
              <div key={i} className="bg-white rounded-xl p-4 border border-blue-100">
                <code className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded block mb-2">
                  {p.scope}
                </code>
                <p className="text-xs text-gray-600 leading-relaxed">{p.purpose}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Our use of Google API data follows the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="underline">
              Google API Services User Data Policy
            </a>
            , including Limited Use requirements. We do not sell or use your data for advertising.
          </p>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section className="text-center px-6 pb-20">
        <button
          onClick={handleGetStarted}
          disabled={isConnecting}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-4 rounded-xl text-lg transition-colors disabled:opacity-60"
        >
          Start cleaning for free -&gt;
        </button>
        <p className="text-sm text-gray-400 mt-3">5,000 free credits - No credit card</p>
      </section>


    </div>
  );
}
