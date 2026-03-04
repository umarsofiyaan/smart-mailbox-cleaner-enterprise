// src/pages/Privacy.jsx
// Privacy Policy - required for Google OAuth verification.
// Covers: Gmail API usage, data collection, retention, third parties.
import { Link } from 'react-router-dom';

export default function Privacy() {
  const lastUpdated = 'February 22, 2026';
  const appName = 'Smart Mailbox Cleaner';
  const domain = 'smart-mailbox-cleaner.umarsofiyaan.shop';
  const contactEmail = 'umarsofiyaan@gmail.com';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon-72.png" alt="Smart Mailbox Cleaner" className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">{appName}</span>
          </Link>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-500 text-sm">Privacy Policy</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-gray-500 text-sm mb-10">Last updated: {lastUpdated}</p>

          <Section title="1. Introduction">
            <P>
              {appName} ("we," "our," or "us") operates the website{' '}
              <a href={`https://${domain}`} className="text-brand-600 underline">{domain}</a> (the "Service").
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information
              when you use our Service.
            </P>
            <P>
              By using the Service, you agree to the collection and use of information in accordance with this policy.
            </P>
          </Section>

          <Section title="2. Information We Collect">
            <H3>2.1 Google Account Information</H3>
            <P>
              When you sign in with Google, we receive the following information from your Google account:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Your name and email address</li>
              <li>Your Google profile picture (avatar)</li>
              <li>A unique Google user ID (used to identify your account)</li>
            </ul>

            <H3>2.2 Gmail Metadata (NOT Email Content)</H3>
            <P>
              <strong>We never read, store, or process the body or content of your emails.</strong>{' '}
              Our Service accesses only Gmail message metadata - specifically:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Message size (in bytes)</li>
              <li>Message date and labels (e.g., "Promotions," "Social")</li>
              <li>Thread ID (to detect reply chains)</li>
              <li>Attachment filename (e.g., "invite.ics") - not the attachment content</li>
              <li>Whether a message has an attachment or Drive link</li>
            </ul>
            <P>
              This metadata is used solely to categorise emails and estimate how much storage space
              they occupy. It is <strong>never</strong> stored permanently on our servers - it is
              processed in memory during a scan and then discarded.
            </P>

            <H3>2.3 Storage Usage Data</H3>
            <P>
              We access your Gmail storage quota information (total quota and amount used) to display
              your storage usage in the dashboard.
            </P>

            <H3>2.4 Cleanup Action Records</H3>
            <P>
              When you initiate a cleanup, we store a record of the action including: the category of
              emails cleaned, how many emails were moved, estimated bytes freed, and the Gmail message
              IDs affected (to enable the 30-day undo feature). These records are retained for 30 days
              after the undo window closes, then message IDs are deleted.
            </P>

            <H3>2.5 Usage and Technical Data</H3>
            <P>
              We may collect technical information such as your IP address, browser type, and error
              logs for the purpose of improving service reliability and debugging issues. This data
              is processed by Sentry (see Section 5) and is not sold or shared for advertising purposes.
            </P>
          </Section>

          <Section title="3. How We Use Your Information">
            <P>We use the information we collect to:</P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>Provide, operate, and maintain the Service</li>
              <li>Identify large, old, or low-value emails in your Gmail account</li>
              <li>Execute cleanup actions (move emails to Trash) at your request</li>
              <li>Enable undo functionality within 30 days of a cleanup</li>
              <li>Send you transactional emails (welcome, cleanup receipts, quota alerts)</li>
              <li>Process subscription payments (Pro plan)</li>
              <li>Detect and prevent fraudulent or abusive use of the Service</li>
              <li>Improve the reliability and performance of the Service</li>
              <li>Respond to your support requests</li>
            </ul>
            <P>
              <strong>We do not use your Gmail data for advertising, profiling, or any purpose
              other than operating the Service as described above.</strong>
            </P>
          </Section>

          <Section title="4. Google API Scopes">
            <P>
              {appName} requests the following Google OAuth scopes:
            </P>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm font-mono text-gray-700 space-y-2">
              <div><span className="text-brand-600">gmail.readonly</span> - Read message metadata (size, labels, dates). Used to scan and categorise emails.</div>
              <div><span className="text-brand-600">gmail.modify</span> - Move messages to Trash and restore them. Used for cleanup and undo actions.</div>
              <div><span className="text-brand-600">drive.metadata.readonly</span> - Check storage quota. Used to display your storage usage.</div>
            </div>
            <P>
              Our use of information received from Google APIs adheres to the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. We do not transfer your Google user data to
              third parties except as necessary to provide the Service, and we do not use it for
              serving advertisements.
            </P>
          </Section>

          <Section title="5. Third-Party Services">
            <P>We use the following third-party services to operate the Service:</P>

            <H3>Supabase (Database)</H3>
            <P>
              We store your account information, scan records, and cleanup history in a PostgreSQL
              database hosted on Supabase. Data is stored in the EU region and is encrypted at rest.{' '}
              <a href="https://supabase.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Supabase Privacy Policy</a>
            </P>

            <H3>Render (Server Hosting)</H3>
            <P>
              Our backend server runs on Render. Your requests are processed on Render's
              infrastructure.{' '}
              <a href="https://render.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Render Privacy Policy</a>
            </P>

            <H3>Cloudflare (Frontend Hosting & CDN)</H3>
            <P>
              The frontend of the Service is hosted on Cloudflare Pages.{' '}
              <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Cloudflare Privacy Policy</a>
            </P>

            <H3>Razorpay (Payment Processing)</H3>
            <P>
              If you subscribe to the Pro plan, payments are processed by Razorpay. We do not store
              your payment card details.{' '}
              <a href="https://razorpay.com/privacy/" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Razorpay Privacy Policy</a>
            </P>

            <H3>Resend (Transactional Email)</H3>
            <P>
              Transactional emails (welcome, cleanup receipts, quota notifications) are delivered
              via Resend. Your email address is shared with Resend solely for this purpose.{' '}
              <a href="https://resend.com/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Resend Privacy Policy</a>
            </P>

            <H3>Sentry (Error Monitoring)</H3>
            <P>
              We use Sentry to capture application errors. Sentry may receive your IP address and
              browser information. Email content and OAuth tokens are explicitly scrubbed before
              any data is sent to Sentry.{' '}
              <a href="https://sentry.io/privacy/" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Sentry Privacy Policy</a>
            </P>
          </Section>

          <Section title="6. Data Retention">
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm">
              <li><strong>Gmail metadata</strong>: Processed in memory during scans and never written to persistent storage.</li>
              <li><strong>Scan results</strong> (categories, counts, storage stats): Retained for 90 days after a scan completes, then automatically deleted.</li>
              <li><strong>Cleanup action records</strong>: Retained for 30 days past the undo window (60 days total). Gmail message IDs are deleted after 30 days; the summary record (count, category, bytes freed) is kept for your history.</li>
              <li><strong>Account information</strong>: Retained until you delete your account.</li>
              <li><strong>Payment records</strong>: Retained for 7 years as required by Indian tax law (for Pro subscribers).</li>
            </ul>
          </Section>

          <Section title="7. Data Security">
            <P>
              We implement industry-standard security measures to protect your data:
            </P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li>OAuth tokens are encrypted using AES-256 before being stored in our database</li>
              <li>All data in transit is encrypted using TLS 1.2 or higher</li>
              <li>Database access is restricted to our backend servers via allowlisted IPs</li>
              <li>We never log or store email content, subject lines, or sender/recipient information</li>
            </ul>
            <P>
              However, no method of transmission over the Internet or method of electronic storage is
              100% secure. We cannot guarantee absolute security.
            </P>
          </Section>

          <Section title="8. Your Rights">
            <P>You have the right to:</P>
            <ul className="list-disc pl-6 space-y-1 text-gray-600 text-sm mb-4">
              <li><strong>Access</strong>: Request a copy of the personal data we hold about you.</li>
              <li><strong>Rectification</strong>: Request correction of inaccurate data.</li>
              <li><strong>Deletion</strong>: Delete your account and associated data at any time from the dashboard settings, or by emailing us.</li>
              <li><strong>Revoke Google access</strong>: You can revoke our access to your Google account at any time via <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">Google Account Permissions</a>.</li>
              <li><strong>Data portability</strong>: Request an export of your data in a machine-readable format.</li>
            </ul>
            <P>
              To exercise any of these rights, email us at{' '}
              <a href={`mailto:${contactEmail}`} className="text-brand-600 underline">{contactEmail}</a>.
              We will respond within 30 days.
            </P>
          </Section>

          <Section title="9. Children's Privacy">
            <P>
              The Service is not directed to children under the age of 13. We do not knowingly collect
              personal information from children under 13. If you are a parent or guardian and believe
              your child has provided us with personal information, please contact us.
            </P>
          </Section>

          <Section title="10. Changes to This Policy">
            <P>
              We may update this Privacy Policy from time to time. We will notify you of any significant
              changes by posting a notice on the Service or by sending an email to the address
              associated with your account. Your continued use of the Service after changes become
              effective constitutes acceptance of the updated policy.
            </P>
          </Section>

          <Section title="11. Contact Us">
            <P>
              If you have any questions about this Privacy Policy, please contact us at:
            </P>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">
              <p className="font-semibold">{appName}</p>
              <p>Email: <a href={`mailto:${contactEmail}`} className="text-brand-600 underline">{contactEmail}</a></p>
              <p>Website: <a href={`https://${domain}`} className="text-brand-600 underline">{domain}</a></p>
            </div>
          </Section>
        </div>
      </main>


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
