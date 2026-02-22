// src/services/emailService.js
// Transactional email via Resend (https://resend.com).
// Free tier: 3,000 emails/month — plenty for early stage.
//
// Required env var : RESEND_API_KEY
// Optional env var : EMAIL_FROM  (defaults to noreply@yourdomain.com)
//
// All sends are fire-and-forget. A failed email logs a warning
// but NEVER throws — it must never break any user-facing flow.

const logger = require('../utils/logger');

const RESEND_API = 'https://api.resend.com/emails';
const API_KEY   = process.env.RESEND_API_KEY;
const FROM      = process.env.EMAIL_FROM
  || 'Smart Mailbox Cleaner <noreply@mailboxcleaner.umarsofiyaan.shop>';
const APP_URL   = process.env.FRONTEND_URL
  || 'https://app.mailboxcleaner.umarsofiyaan.shop';

// ─── Core send ────────────────────────────────────────────────────────────────

async function sendEmail({ to, subject, html, text }) {
  if (!API_KEY) {
    logger.warn('emailService: RESEND_API_KEY not set — email skipped', { to, subject });
    return;
  }
  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM, to, subject, html, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn('emailService: Resend API error', { status: res.status, body, to, subject });
    } else {
      logger.info('emailService: sent', { to, subject });
    }
  } catch (err) {
    logger.warn('emailService: network error', { error: err.message, to, subject });
  }
}

// ─── Shared HTML shell ────────────────────────────────────────────────────────

function shell(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .w{max-width:560px;margin:40px auto}
  .card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .logo{display:flex;align-items:center;gap:10px;margin-bottom:28px}
  .logo-icon{width:38px;height:38px;background:linear-gradient(135deg,#4F46E5,#7C3AED);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px}
  .logo-name{font-weight:700;font-size:16px;color:#111827}
  h1{margin:0 0 12px;font-size:22px;color:#111827;font-weight:700}
  p{margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6}
  .stats{display:flex;gap:14px;margin:22px 0}
  .stat{flex:1;background:#f9fafb;border-radius:12px;padding:14px;text-align:center}
  .sv{font-size:22px;font-weight:700;color:#4F46E5}
  .sl{font-size:12px;color:#6B7280;margin-top:3px}
  .btn{display:inline-block;background:linear-gradient(135deg,#4F46E5,#7C3AED);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:12px;margin:6px 0}
  .btn-o{display:inline-block;border:1.5px solid #4F46E5;color:#4F46E5;text-decoration:none;font-weight:600;font-size:14px;padding:11px 28px;border-radius:12px}
  hr{border:none;border-top:1px solid #f3f4f6;margin:22px 0}
  .warn{background:#FEF3C7;border:1.5px solid #FDE68A;border-radius:12px;padding:14px 18px;margin:18px 0}
  .warn p{color:#92400E;margin:0}
  .ok{background:#ECFDF5;border:1.5px solid #A7F3D0;border-radius:12px;padding:14px 18px;margin:18px 0}
  .ok p{color:#065F46;margin:0}
  .foot{text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px}
</style></head><body>
<div class="w"><div class="card">
  <div class="logo"><div class="logo-icon">📬</div><span class="logo-name">Smart Mailbox Cleaner</span></div>
  ${body}
  <hr/>
  <p style="font-size:13px;color:#9CA3AF;margin:0">You received this because you use Smart Mailbox Cleaner. Questions? Reply to this email.</p>
</div>
<div class="foot">© ${new Date().getFullYear()} Smart Mailbox Cleaner · <a href="${APP_URL}" style="color:#6B7280">Open App</a></div>
</div></body></html>`;
}

// ─── 1. Welcome email ─────────────────────────────────────────────────────────

async function sendWelcomeEmail(email, displayName) {
  const name = (displayName || 'there').split(' ')[0];
  const html = shell(`
    <h1>Welcome, ${name}! 👋</h1>
    <p>Your Gmail is about to get a lot cleaner. Here's what you get on the <strong>free plan</strong>:</p>
    <div class="stats">
      <div class="stat"><div class="sv">500</div><div class="sl">Lifetime credits</div></div>
      <div class="stat"><div class="sv">30d</div><div class="sl">Undo window</div></div>
      <div class="stat"><div class="sv">7</div><div class="sl">Categories</div></div>
    </div>
    <p>Scan your mailbox — it takes 1–3 minutes and we only read metadata, never email content.</p>
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/dashboard" class="btn">Scan My Mailbox →</a>
    </div>
    <div class="ok"><p>🔒 <strong>Privacy first:</strong> We never read or store your email content. Only sender, subject, size, and date are used.</p></div>
  `);
  await sendEmail({
    to: email,
    subject: `Welcome to Smart Mailbox Cleaner, ${name}! 📬`,
    html,
    text: `Welcome ${name}!\nYou have 500 free lifetime email credits.\nScan now: ${APP_URL}/dashboard`,
  });
}

// ─── 2. Cleanup receipt ───────────────────────────────────────────────────────

async function sendCleanupReceipt(email, displayName, { category, messageCount, bytesFreed, undoExpiresAt }) {
  const name   = (displayName || 'there').split(' ')[0];
  const bytes  = bytesFreed || 0;
  const size   = bytes > 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const catLabel = (category || '').replace(/_/g, ' ');
  const expiry   = undoExpiresAt
    ? new Date(undoExpiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : '30 days from now';

  const html = shell(`
    <h1>Cleanup complete ✅</h1>
    <p>Great work, ${name}! Here's what was moved to Trash.</p>
    <div class="stats">
      <div class="stat"><div class="sv">${messageCount.toLocaleString()}</div><div class="sl">Emails trashed</div></div>
      <div class="stat"><div class="sv">${size}</div><div class="sl">Space freed</div></div>
    </div>
    <p><strong>Category:</strong> ${catLabel}</p>
    <div class="warn"><p>↩ <strong>Changed your mind?</strong> You can undo this cleanup until <strong>${expiry}</strong>. After that, Gmail permanently deletes them from Trash.</p></div>
    <div style="text-align:center;margin:22px 0">
      <a href="${APP_URL}/dashboard" class="btn-o">View Cleanup History</a>
    </div>
  `);
  await sendEmail({
    to: email,
    subject: `✅ ${messageCount} emails cleaned up (${size} freed)`,
    html,
    text: `Cleanup complete! ${messageCount} emails trashed, ${size} freed.\nUndo by: ${expiry}\n${APP_URL}/dashboard`,
  });
}

// ─── 3. Low quota warning (fired once at 80%) ─────────────────────────────────

async function sendQuotaWarningEmail(email, displayName, { lifetimeUsed, lifetimeAllowance }) {
  const name      = (displayName || 'there').split(' ')[0];
  const remaining = lifetimeAllowance - lifetimeUsed;
  const pct       = Math.round((lifetimeUsed / lifetimeAllowance) * 100);

  const html = shell(`
    <h1>You've used ${pct}% of your free credits ⚠️</h1>
    <p>Hey ${name}, just a heads-up — you're running low on lifetime free email credits.</p>
    <div class="stats">
      <div class="stat"><div class="sv" style="color:#D97706">${remaining}</div><div class="sl">Credits remaining</div></div>
      <div class="stat"><div class="sv">${lifetimeUsed}</div><div class="sl">Credits used</div></div>
    </div>
    <div class="warn"><p>⚡ When free credits run out, you'll automatically get <strong>50 emails/day</strong> — or upgrade to Pro for unlimited cleanup.</p></div>
    <p>Pro gives you unlimited cleanups, full scan depth, and priority support for just <strong>₹500/month</strong>.</p>
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/pricing" class="btn">Upgrade to Pro →</a>
    </div>
  `);
  await sendEmail({
    to: email,
    subject: `⚠️ Only ${remaining} free email credits remaining`,
    html,
    text: `You've used ${pct}% of your free credits (${remaining} left).\nUpgrade to Pro: ${APP_URL}/pricing`,
  });
}

// ─── 4. Pro upgrade confirmation ─────────────────────────────────────────────

async function sendProUpgradeEmail(email, displayName, periodEnd) {
  const name   = (displayName || 'there').split(' ')[0];
  const expiry = periodEnd
    ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : 'next month';

  const html = shell(`
    <h1>You're now Pro! 🎉</h1>
    <p>Welcome to Pro, ${name}. Unlimited email cleanup is now unlocked.</p>
    <div class="ok"><p>⭐ <strong>Pro features unlocked:</strong> Unlimited cleanups · Full scan depth · 30-day undo · Priority support</p></div>
    <div class="stats">
      <div class="stat"><div class="sv">∞</div><div class="sl">Emails / month</div></div>
      <div class="stat"><div class="sv">30d</div><div class="sl">Undo window</div></div>
    </div>
    <p>Subscription renews on <strong>${expiry}</strong>. Manage or cancel anytime from the dashboard.</p>
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/dashboard" class="btn">Start Cleaning →</a>
    </div>
  `);
  await sendEmail({
    to: email,
    subject: `🎉 You're now on Smart Mailbox Cleaner Pro!`,
    html,
    text: `You're now on Pro! Unlimited cleanups unlocked.\nRenews: ${expiry}\n${APP_URL}/dashboard`,
  });
}

module.exports = {
  sendWelcomeEmail,
  sendCleanupReceipt,
  sendQuotaWarningEmail,
  sendProUpgradeEmail,
};
