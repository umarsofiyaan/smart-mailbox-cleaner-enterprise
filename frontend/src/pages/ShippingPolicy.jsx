// src/pages/ShippingPolicy.jsx
import { Link } from 'react-router-dom';
import SEOHead from '../components/SEOHead';

const APP_NAME     = 'Smart Mailbox Cleaner';
const DOMAIN       = 'smart-mailbox-cleaner.umarsofiyaan.shop';
const CONTACT      = 'support@umarsofiyaan.shop';
const LAST_UPDATED = 'March 12, 2026';

export default function ShippingPolicy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SEOHead
        title="Shipping & Delivery Policy"
        description="Smart Mailbox Cleaner is a digital SaaS product. All plans are delivered instantly — no physical shipping."
        path="/shipping-policy"
      />

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/icon-72.png" alt={APP_NAME} className="w-8 h-8 rounded-lg" />
            <span className="font-bold text-gray-900">{APP_NAME}</span>
          </Link>
          <span className="text-gray-300 mx-1">/</span>
          <span className="text-gray-500 text-sm">Shipping & Delivery Policy</span>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 md:p-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Shipping & Delivery Policy</h1>
          <p className="text-gray-500 text-sm mb-10">Last updated: {LAST_UPDATED}</p>

          {/* Digital product callout */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-5 py-4 mb-8 flex items-start gap-3">
            <span className="text-2xl mt-0.5 flex-shrink-0">📦</span>
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">
                Smart Mailbox Cleaner is a 100% digital product
              </p>
              <p className="text-sm text-blue-700">
                No physical goods are sold or shipped. All plans and services are delivered
                electronically, instantly upon successful payment.
              </p>
            </div>
          </div>

          <Section title="1. Digital Delivery">
            <P>
              {APP_NAME} is a Software-as-a-Service (SaaS) web application. All purchases —
              including Starter, Pro, and Power plans — are digital and delivered electronically.
              There are no physical products, no boxes, no courier services, and no shipping fees
              of any kind.
            </P>
          </Section>

          <Section title="2. Delivery Method & Timing">
            <P>
              Upon successful payment, your plan is activated <strong>immediately and automatically</strong>.
              You will:
            </P>
            <ul className="list-disc pl-6 space-y-2 text-gray-600 text-sm mb-4">
              <li>Be redirected to your dashboard with the new plan active.</li>
              <li>See your updated credit balance or plan status reflected in real time.</li>
              <li>Receive a payment confirmation email to your registered email address.</li>
            </ul>
            <P>
              There is no waiting period, no download required, and no manual activation step.
              If your plan does not activate within 5 minutes of a successful payment, please
              contact us at{' '}
              <a href={`mailto:${CONTACT}`} className="text-blue-600 underline">{CONTACT}</a>.
            </P>
          </Section>

          <Section title="3. Exchange Policy">
            <P>
              Because our plans are digital and non-transferable, traditional exchanges (e.g.
              swapping one physical item for another) do not apply. However, we handle the
              following plan-related scenarios:
            </P>

            <div className="space-y-3 mb-4">
              <ExchangeRow
                title="Purchased the wrong plan"
                desc="Contact us within 48 hours. If no credits have been used, we can cancel the incorrect purchase and issue a new one for the correct plan (subject to our Refund Policy)."
              />
              <ExchangeRow
                title="Want to upgrade to a higher plan"
                desc="Simply purchase the higher plan. Credits stack — your existing credits will not be lost."
              />
              <ExchangeRow
                title="Plan not activated after payment"
                desc="Email us your Razorpay payment ID and we will manually activate your plan within 1 business day."
              />
            </div>
          </Section>

          <Section title="4. No Physical Shipment">
            <P>
              We do not ship any physical goods under any circumstance. If you received a
              solicitation or invoice claiming physical goods from {APP_NAME}, please report it
              to us immediately as it may be fraudulent.
            </P>
          </Section>

          <Section title="5. Contact">
            <P>
              For any questions about delivery or plan activation:
            </P>
            <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-700">
              <p className="font-semibold">{APP_NAME}</p>
              <p>Email: <a href={`mailto:${CONTACT}`} className="text-blue-600 underline">{CONTACT}</a></p>
              <p>Website: <a href={`https://${DOMAIN}`} className="text-blue-600 underline">{DOMAIN}</a></p>
              <p className="mt-2 text-gray-500">Response time: 1–2 business days</p>
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

function ExchangeRow({ title, desc }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <p className="text-sm font-semibold text-gray-800 mb-0.5">{title}</p>
      <p className="text-sm text-gray-600">{desc}</p>
    </div>
  );
}
