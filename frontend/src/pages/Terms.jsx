// src/pages/Terms.jsx
// Terms of Service — required for Google OAuth verification.

export default function Terms() {
  const lastUpdated = 'February 22, 2026';
  const appName = 'Smart Mailbox Cleaner';
  const domain = 'smart-mailbox-cleaner.umarsofiyaan.shop';
  const contactEmail = 'umarsofiyaan@gmail.com';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
              <span className="text-sm">📬</span>
            </div>
            <span className="font-bold text-gray-900">{appName}</span>
          </a>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-500 text-sm">Terms of Service</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
          <p className="text-gray-500 text-sm mb-10">Last updated: {lastUpdated}</p>

          <Section title="1. Acceptance of Terms">
            <P>
              By accessing or using {appName} ("the Service"), you agree to be bound by these Terms of
              Service ("Terms"). If you do not agree to these Terms, do not use the Service.
            </P>
            <P>
              These Terms apply to all users of the Service, including free and paid (Pro) subscribers.
            </P>
          </Section>

          <Section title="2. Description of Service">
            <P>
              {appName} is a web application that connects to your Gmail account via Google OAuth to:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Analyse Gmail message metadata to identify emails consuming significant storage space</li>
              <li>Present categorised cleanup suggestions (large attachments, old promotions, social notifications, etc.)</li>
              <li>Move selected emails to Gmail's Trash at your explicit request</li>
              <li>Allow you to undo cleanup actions and restore emails from Trash within 30 days</li>
            </ul>
            <P>
              The Service <strong>never reads, stores, or processes the body or content of your emails</strong>.
              All email access is limited to metadata (size, labels, dates). Gmail itself handles all
              email data — we only instruct Gmail to move emails to Trash using the Gmail API.
            </P>
          </Section>

          <Section title="3. Eligibility">
            <P>
              You must be at least 13 years of age to use the Service. By using the Service, you
              represent and warrant that you meet this requirement and that your use of the Service
              complies with all applicable laws and regulations.
            </P>
          </Section>

          <Section title="4. Google Account and Permissions">
            <P>
              The Service requires you to authenticate with a Google account and grant certain
              Gmail API permissions. You are responsible for:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Maintaining the security of your Google account</li>
              <li>All activity that occurs under your account</li>
              <li>Ensuring you have the right to grant us access to the Gmail account you connect</li>
            </ul>
            <P>
              You can revoke access to your Google account at any time via{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">
                Google Account Permissions
              </a>.
            </P>
          </Section>

          <Section title="5. Cleanup Actions and Undo">
            <P>
              When you initiate a cleanup action, emails are moved to Gmail's Trash folder — they
              are <strong>not permanently deleted</strong> by the Service. You have <strong>30 days</strong> from
              the date of a cleanup action to restore ("undo") that action via the dashboard.
            </P>
            <P>
              <strong>Important:</strong> Gmail automatically and permanently purges emails that have
              been in Trash for 30 days. Once Gmail purges an email, it cannot be recovered by the
              Service or by Gmail. We are not responsible for emails that are permanently deleted by
              Gmail after the 30-day Trash retention period.
            </P>
            <P>
              You are solely responsible for confirming that you wish to move emails to Trash before
              initiating a cleanup action. We recommend reviewing the email list and confidence
              ratings before proceeding.
            </P>
          </Section>

          <Section title="6. Free Tier and Quota">
            <P>
              Free-tier users receive a lifetime allowance of <strong>500 cleanup credits</strong>.
              Each email moved to Trash consumes one credit. After the lifetime allowance is exhausted,
              free users receive <strong>50 credits per day</strong>, renewed automatically at
              midnight UTC.
            </P>
            <P>
              We reserve the right to adjust quota limits at any time with reasonable notice.
            </P>
          </Section>

          <Section title="7. Pro Subscription">
            <H3>7.1 Billing</H3>
            <P>
              Pro subscriptions are billed monthly at the price displayed on the pricing page.
              Payments are processed by Razorpay. By subscribing, you authorise recurring monthly
              charges to your payment method.
            </P>

            <H3>7.2 Cancellation</H3>
            <P>
              You may cancel your Pro subscription at any time from the dashboard ("Manage subscription").
              Upon cancellation, your Pro access continues until the end of the current billing period.
              No refunds are provided for partial billing periods.
            </P>

            <H3>7.3 Refunds</H3>
            <P>
              We offer a full refund within <strong>7 days</strong> of your first Pro subscription
              payment if you are not satisfied, provided you have not cleaned more than 500 emails
              during that period. To request a refund, email us at{' '}
              <a href={`mailto:${contactEmail}`} className="text-brand-600 underline">{contactEmail}</a>.
            </P>

            <H3>7.4 Price Changes</H3>
            <P>
              We may change subscription prices with at least 30 days' notice sent to your registered
              email address. Continued use after a price change constitutes acceptance.
            </P>
          </Section>

          <Section title="8. Acceptable Use">
            <P>You agree not to:</P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Use the Service to access Gmail accounts you do not own or are not authorised to manage</li>
              <li>Attempt to reverse engineer, decompile, or extract the source code of the Service</li>
              <li>Use the Service in any way that violates Google's Terms of Service or API policies</li>
              <li>Use automated scripts or bots to interact with the Service outside of its intended interface</li>
              <li>Attempt to circumvent rate limits, quota restrictions, or access controls</li>
              <li>Resell or sublicense access to the Service</li>
            </ul>
          </Section>

          <Section title="9. Intellectual Property">
            <P>
              The Service and its original content, features, and functionality are and will remain
              the exclusive property of {appName} and its operators. The Service is protected by
              copyright and other intellectual property laws.
            </P>
          </Section>

          <Section title="10. Disclaimers">
            <P>
              The Service is provided on an "AS IS" and "AS AVAILABLE" basis without any warranties,
              express or implied. We do not warrant that:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>The Service will be uninterrupted, error-free, or secure</li>
              <li>The categorisation of emails as "safe to delete" is accurate in all cases</li>
              <li>Gmail API access will always be available or function as expected</li>
            </ul>
            <P>
              <strong>You are solely responsible for reviewing emails before cleanup and for any
              consequences of moving emails to Trash.</strong> Always verify that emails marked for
              cleanup do not contain important information before proceeding.
            </P>
          </Section>

          <Section title="11. Limitation of Liability">
            <P>
              To the maximum extent permitted by applicable law, {appName} and its operators shall not
              be liable for any indirect, incidental, special, consequential, or punitive damages,
              including but not limited to loss of data, loss of emails, or loss of business, arising
              out of your use of the Service.
            </P>
            <P>
              Our total liability to you for any claims arising from your use of the Service shall
              not exceed the amount you paid us in the 12 months preceding the claim, or ₹1,000,
              whichever is greater.
            </P>
          </Section>

          <Section title="12. Termination">
            <P>
              We may suspend or terminate your access to the Service at our discretion, without notice,
              for conduct that we believe violates these Terms or is harmful to other users, us, or
              third parties.
            </P>
            <P>
              You may delete your account at any time from the dashboard. Upon deletion, your personal
              data will be removed in accordance with our Privacy Policy.
            </P>
          </Section>

          <Section title="13. Changes to Terms">
            <P>
              We reserve the right to update these Terms at any time. We will notify you of material
              changes by email or by posting a notice in the Service at least 14 days before the
              changes take effect. Continued use after the effective date constitutes acceptance.
            </P>
          </Section>

          <Section title="14. Governing Law">
            <P>
              These Terms are governed by the laws of India. Any disputes arising from or relating
              to these Terms or the Service shall be subject to the exclusive jurisdiction of the
              courts of India.
            </P>
          </Section>

          <Section title="15. Contact">
            <P>
              For questions about these Terms, contact us at:
            </P>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">
              <p className="font-semibold">{appName}</p>
              <p>Email: <a href={`mailto:${contactEmail}`} className="text-brand-600 underline">{contactEmail}</a></p>
              <p>Website: <a href={`https://${domain}`} className="text-brand-600 underline">{domain}</a></p>
            </div>
          </Section>
        </div>
      </main>

      <footer className="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-gray-400">
        <span>© 2026 {appName}</span>
        <div className="flex gap-4">
          <a href="/privacy" className="hover:text-gray-600">Privacy Policy</a>
          <a href="/terms" className="hover:text-gray-600">Terms of Service</a>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-gray-900 mb-3 pb-2 border-b border-gray-100">{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }) {
  return <h3 className="font-semibold text-gray-900 text-sm mt-4 mb-1">{children}</h3>;
}

function P({ children }) {
  return <p className="text-gray-600 text-sm leading-relaxed mb-3">{children}</p>;
}
