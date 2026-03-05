import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { authApi } from '../api/client';

export default function Home() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

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
        <div className="w-7 h-7 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
      </div>
    );
  }

  const steps = [
    'Sign in securely using your Google account.',
    'The application scans your Gmail mailbox.',
    'Identify bulk or unwanted emails.',
    'Select emails to delete.',
    'Delete emails in bulk.',
    'Restore deleted emails if needed.',
  ];

  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-gray-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900 text-sm">Smart Mailbox Cleaner</span>
          </div>
          <div className="flex items-center gap-6">
            <Link to="/privacy-policy" className="text-sm text-gray-500 hover:text-gray-900">Privacy Policy</Link>
            <Link to="/terms-of-service" className="text-sm text-gray-500 hover:text-gray-900">Terms of Service</Link>
            <button
              onClick={handleGetStarted}
              disabled={isConnecting}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
            >
              {isConnecting ? 'Connecting...' : 'Sign in with Google'}
            </button>
          </div>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 leading-tight mb-4">Smart Mailbox Cleaner</h1>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto mb-8 leading-relaxed">
          Smart Mailbox Cleaner helps Gmail users identify and remove unwanted emails in bulk to keep their mailbox
          organized and reduce storage usage.
        </p>

        <button
          onClick={handleGetStarted}
          disabled={isConnecting}
          className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-lg px-8 py-4 rounded-xl transition-colors disabled:opacity-60"
        >
          {isConnecting ? 'Connecting to Google...' : 'Sign in with Google'}
        </button>

        <p className="text-sm text-gray-500 mt-4">
          Smart Mailbox Cleaner uses Gmail API access and complies with Google's Limited Use requirements.
        </p>

        {isConnecting && (
          <p className="text-sm text-blue-600 mt-2">Waking up server. First visit can take up to 60 seconds.</p>
        )}
        {connectError && <p className="text-sm text-red-600 mt-2">{connectError}</p>}
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">How It Works</h2>
        <ol className="grid md:grid-cols-2 gap-4 list-decimal pl-5 text-gray-700 text-sm md:text-base">
          {steps.map((step) => (
            <li key={step} className="leading-relaxed">{step}</li>
          ))}
        </ol>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Google Data Access</h2>
        <p className="text-gray-600 mb-4 leading-relaxed">
          Smart Mailbox Cleaner uses the Gmail API to help users analyze and manage their mailbox.
        </p>
        <p className="text-gray-600 mb-4 leading-relaxed">
          The application only accesses Gmail data after the user explicitly authorizes access through Google OAuth.
        </p>
        <p className="text-gray-700 font-semibold mb-2">The app may access:</p>
        <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-4">
          <li>Email metadata (sender, subject, date)</li>
          <li>Email identifiers required for deletion</li>
          <li>Gmail labels and message organization data</li>
        </ul>
        <p className="text-gray-700 font-semibold mb-2">This data is used only to:</p>
        <ul className="list-disc pl-5 text-gray-600 space-y-1 mb-4">
          <li>Identify emails for cleanup</li>
          <li>Allow users to delete unwanted emails</li>
          <li>Allow restoration of deleted emails</li>
        </ul>
        <p className="text-gray-600 leading-relaxed">
          Smart Mailbox Cleaner does not sell, share, or use Gmail user data for advertising.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Security and Privacy</h2>
        <p className="text-gray-600 mb-3 leading-relaxed">
          Authentication is handled using Google's OAuth 2.0 authorization system.
        </p>
        <p className="text-gray-600 mb-3 leading-relaxed">
          Your Google password is never visible to or stored by Smart Mailbox Cleaner.
        </p>
        <p className="text-gray-600 mb-3 leading-relaxed">
          All Gmail access occurs only after explicit user authorization.
        </p>
        <p className="text-gray-600 leading-relaxed">
          Users can revoke access at any time via:{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline"
          >
            https://myaccount.google.com/permissions
          </a>
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Contact</h2>
        <p className="text-gray-600">For support or inquiries please contact:</p>
        <p className="text-gray-800 font-semibold mt-2">support@umarsofiyaan.shop</p>
      </section>
    </div>
  );
}
