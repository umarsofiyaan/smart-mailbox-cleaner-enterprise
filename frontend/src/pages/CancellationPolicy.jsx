// src/pages/CancellationPolicy.jsx
import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';

const APP_NAME     = 'Smart Mailbox Cleaner';
const DOMAIN       = 'smart-mailbox-cleaner.umarsofiyaan.shop';
const CONTACT      = 'support@umarsofiyaan.shop';
const LAST_UPDATED = 'March 12, 2026';

export default function CancellationPolicy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SEOHead
        title="Cancellation Policy"
        description="Smart Mailbox Cleaner cancellation policy — how one-time plans work and what cancellation means."
        path="/cancellation-policy"
      />

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon-72.png" alt={APP_NAME} className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">{APP_NAME}</span>
          </Link>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-500 text-sm">Cancellation Policy</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Cancellation Policy</h1>
          <p className="text-gray-500 text-sm mb-10">Last updated: {LAST_UPDATED}</p>

          <Section title="1. No Subscription — No Recurring Charges">
            <P>
              {APP_NAME} uses a <strong>one-time payment model</strong>. There are no subscriptions,
              no recurring billing cycles, and no automatic charges. You pay once and receive plan
              benefits immediately — there is nothing to "cancel" in the traditional sense.
            </P>
            <P>
              You will <strong>never be charged again</strong> after your one-time purchase unless
              you manually choose to buy another plan.
            </P>
          </Section>

          <Section title="2. Plan Types and How They Work">
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm border border-gray-200 rounded-xl overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Plan</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Type</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700">Expires?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-4 py-3 text-gray-800 font-medium">Free</td>
                    <td className="px-4 py-3 text-gray-600">1,000 one-time credits</td>
                    <td className="px-4 py-3 text-gray-600">No</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-gray-800 font-medium">Starter</td>
                    <td className="px-4 py-3 text-gray-600">+10,000 credits, one-time</td>
                    <td className="px-4 py-3 text-gray-600">No — credits never expire</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-gray-800 font-medium">Pro</td>
                    <td className="px-4 py-3 text-gray-600">+50,000 credits, one-time</td>
                    <td className="px-4 py-3 text-gray-600">No — credits never expire</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-gray-800 font-medium">Power</td>
                    <td className="px-4 py-3 text-gray-600">Unlimited cleanup, one-time</td>
                    <td className="px-4 py-3 text-gray-600">Yes — 30 days from purchase</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <P>
              For the Power plan, access expires automatically after 30 days. No action is needed
              to cancel — it simply lapses. You will not be charged again.
            </P>
          </Section>

          <Section title="3. Cancelling Your Account">
            <P>
              You can delete your account at any time from{' '}
              <strong>Dashboard → Settings → Delete Account</strong>. Account deletion:
            </P>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm mb-4">
              <li>Permanently removes all your personal data from our systems.</li>
              <li>Revokes our access to your Gmail account.</li>
              <li>Deletes all scan results, cleanup history, and quota records.</li>
              <li>Cannot be undone.</li>
            </ul>
            <P>
              Deleting your account does not trigger any refund. If you wish to request a refund
              before deleting your account, please refer to our{' '}
              <Link to="/refund-policy" className="text-blue-600 underline">Refund Policy</Link>.
            </P>
          </Section>

          <Section title="4. Revoking Google Access">
            <P>
              You can revoke our access to your Gmail at any time via{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                Google Account Permissions
              </a>
              . This stops any further Gmail API access without deleting your account.
            </P>
          </Section>

          <Section title="5. Contact">
            <P>
              For any questions about cancellation or billing, contact us at:
            </P>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">
              <p className="font-semibold">{APP_NAME}</p>
              <p>Email: <a href={`mailto:${CONTACT}`} className="text-blue-600 underline">{CONTACT}</a></p>
              <p>Website: <a href={`https://${DOMAIN}`} className="text-blue-600 underline">{DOMAIN}</a></p>
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }) {
  return <p className="text-gray-600 text-sm leading-relaxed mb-3">{children}</p>;
}
