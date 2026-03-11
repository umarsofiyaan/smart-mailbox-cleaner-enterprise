// src/pages/RefundPolicy.jsx
import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';

const APP_NAME    = 'Smart Mailbox Cleaner';
const DOMAIN      = 'smart-mailbox-cleaner.umarsofiyaan.shop';
const CONTACT     = 'support@umarsofiyaan.shop';
const LAST_UPDATED = 'March 12, 2026';

export default function RefundPolicy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SEOHead
        title="Refund Policy"
        description="Smart Mailbox Cleaner refund policy — eligibility, process, and timelines."
        path="/refund-policy"
      />

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon-72.png" alt={APP_NAME} className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">{APP_NAME}</span>
          </Link>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-500 text-sm">Refund Policy</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Refund Policy</h1>
          <p className="text-gray-500 text-sm mb-10">Last updated: {LAST_UPDATED}</p>

          <Section title="1. Overview">
            <P>
              {APP_NAME} offers one-time plan purchases (Starter, Pro, and Power). Because our
              service delivers digital credits and plan access immediately upon payment, refunds
              are handled on a case-by-case basis under the conditions described below.
            </P>
          </Section>

          <Section title="2. Eligibility for Refund">
            <P>You may be eligible for a full refund <strong>only if</strong>:</P>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm mb-4">
              <li>You were charged but your plan was not activated due to a technical failure on our end.</li>
              <li>You were charged more than once for the same plan due to a payment processing error.</li>
              <li>
                You request a refund within <strong>48 hours</strong> of purchase <em>and</em>{' '}
                <strong>zero cleanup credits have been consumed</strong> — meaning no emails have
                been moved to Trash using the purchased plan.
              </li>
            </ul>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm text-amber-800 font-semibold mb-1">⚠️ Important — Credit Usage is Tracked Server-Side</p>
              <p className="text-sm text-amber-700">
                Every email moved to Trash by our service is recorded in our systems at the time of
                deletion, including a count of credits consumed per cleanup action. This record is
                permanent and cannot be altered by the user. Emptying your Gmail Trash, undoing
                cleanups, or deleting your account <strong>does not erase our record of credits used</strong>.
                Refund eligibility is determined solely by our server-side usage logs, not by the
                current state of your Gmail inbox or Trash.
              </p>
            </div>

            <P>Refunds will <strong>not</strong> be issued if:</P>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm mb-4">
              <li>
                <strong>Any credits have been consumed</strong> — even partially. If you purchased
                Pro (50,000 credits) and used 1 or more credits to delete emails, the plan is
                considered used and is non-refundable.
              </li>
              <li>The refund request is made more than 48 hours after the purchase date.</li>
              <li>The service functioned correctly and delivered the plan as described.</li>
              <li>
                The Gmail Trash was emptied or emails were permanently deleted after cleanup —
                this has no bearing on refund eligibility as our usage records are independent
                of your Gmail state.
              </li>
            </ul>
          </Section>

          <Section title="3. How to Request a Refund">
            <P>
              To request a refund, email us at{' '}
              <a href={`mailto:${CONTACT}`} className="text-blue-600 underline">{CONTACT}</a>{' '}
              with the subject line <strong>"Refund Request"</strong> and include:
            </P>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm mb-4">
              <li>Your registered email address</li>
              <li>The Razorpay payment ID (found in your payment confirmation email)</li>
              <li>The reason for your refund request</li>
            </ul>
            <P>
              Upon receiving your request, we will check our server-side records for credit usage
              associated with your account. If zero credits were consumed and the request is within
              48 hours, the refund will be approved. If any credits were consumed, the refund will
              be denied regardless of the current state of your Gmail inbox or Trash.
            </P>
            <P>
              We will respond within <strong>3 business days</strong> and, if approved, process the
              refund within <strong>5–7 business days</strong>. Refunds are returned to the original
              payment method.
            </P>
          </Section>

          <Section title="4. Partial Refunds">
            <P>
              Partial refunds may be considered at our discretion for the Power plan (unlimited
              cleanup for 30 days) if significant unused time remains and a technical issue
              prevented service use. We do not offer partial refunds for Starter or Pro plans.
            </P>
          </Section>

          <Section title="5. Processing Time">
            <P>
              Once a refund is approved, it typically takes <strong>5–10 business days</strong> for
              the amount to reflect in your account, depending on your bank or payment provider.
            </P>
          </Section>

          <Section title="6. Contact">
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
