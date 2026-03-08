// src/services/emailService.js
// Transactional email via Resend.
// All sends are fire-and-forget; failures are logged and never thrown.

const logger = require('../utils/logger');
const { query } = require('../config/database');

const RESEND_API = 'https://api.resend.com/emails';
const API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Smart Mailbox Cleaner <noreply@mailboxcleaner.umarsofiyaan.shop>';
const APP_URL = process.env.FRONTEND_URL || 'https://smart-mailbox-cleaner.umarsofiyaan.shop';
const FREE_CREDITS = 1000;

async function sendEmail({ to, subject, html, text }) {
  if (!API_KEY) {
    logger.warn('emailService: RESEND_API_KEY not set, email skipped', { to, subject });
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

function shell(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .w{max-width:560px;margin:40px auto}
  .card{background:#fff;border-radius:16px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .logo{display:flex;align-items:center;gap:10px;margin-bottom:28px}
  .logo-icon{width:38px;height:38px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff}
  .logo-name{font-weight:700;font-size:16px;color:#111827}
  h1{margin:0 0 12px;font-size:22px;color:#111827;font-weight:700}
  p{margin:0 0 14px;font-size:15px;color:#374151;line-height:1.6}
  .stats{display:flex;gap:14px;margin:22px 0}
  .stat{flex:1;background:#f9fafb;border-radius:12px;padding:14px;text-align:center}
  .sv{font-size:22px;font-weight:700;color:#2563eb}
  .sl{font-size:12px;color:#6B7280;margin-top:3px}
  .btn{display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:12px;margin:6px 0}
  .btn-o{display:inline-block;border:1.5px solid #2563eb;color:#2563eb;text-decoration:none;font-weight:600;font-size:14px;padding:11px 28px;border-radius:12px}
  hr{border:none;border-top:1px solid #f3f4f6;margin:22px 0}
  .warn{background:#FEF3C7;border:1.5px solid #FDE68A;border-radius:12px;padding:14px 18px;margin:18px 0}
  .warn p{color:#92400E;margin:0}
  .ok{background:#ECFDF5;border:1.5px solid #A7F3D0;border-radius:12px;padding:14px 18px;margin:18px 0}
  .ok p{color:#065F46;margin:0}
  .foot{text-align:center;font-size:12px;color:#9CA3AF;margin-top:20px}
</style></head><body>
<div class="w"><div class="card">
  <div class="logo"><div class="logo-icon">M</div><span class="logo-name">Smart Mailbox Cleaner</span></div>
  ${body}
  <hr/>
  <p style="font-size:13px;color:#9CA3AF;margin:0">You received this because you use Smart Mailbox Cleaner. Questions? Reply to this email.</p>
</div>
<div class="foot">© ${new Date().getFullYear()} Smart Mailbox Cleaner · <a href="${APP_URL}" style="color:#6B7280">Open App</a></div>
</div></body></html>`;
}

async function sendWelcomeEmail(email, displayName) {
  const name = (displayName || 'there').split(' ')[0];
  const html = shell(`
    <h1>Welcome, ${name}</h1>
    <p>Your mailbox is ready for cleanup. On the free plan you get <strong>${FREE_CREDITS.toLocaleString()} one-time delete credits</strong>.</p>
    <div class="stats">
      <div class="stat"><div class="sv">${FREE_CREDITS.toLocaleString()}</div><div class="sl">Free credits</div></div>
      <div class="stat"><div class="sv">30d</div><div class="sl">Undo window</div></div>
      <div class="stat"><div class="sv">7+</div><div class="sl">Cleanup categories</div></div>
    </div>
    <p>Scan your mailbox. We process metadata (sender, labels, size, date) and do not read email content.</p>
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/dashboard" class="btn">Open Dashboard</a>
    </div>
    <div class="ok"><p><strong>Privacy first:</strong> You can revoke app access any time from Google Account Permissions.</p></div>
  `);

  await sendEmail({
    to: email,
    subject: `Welcome to Smart Mailbox Cleaner, ${name}`,
    html,
    text: `Welcome ${name}. You have ${FREE_CREDITS} one-time free delete credits. Open dashboard: ${APP_URL}/dashboard`,
  });
}

async function sendCleanupReceipt(email, displayName, { category, messageCount, bytesFreed, undoExpiresAt }) {
  const name = (displayName || 'there').split(' ')[0];
  const bytes = bytesFreed || 0;
  const size = bytes > 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  const catLabel = (category || '').replace(/_/g, ' ');
  const expiry = undoExpiresAt
    ? new Date(undoExpiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : '30 days from now';

  const html = shell(`
    <h1>Cleanup complete</h1>
    <p>Great work, ${name}. Here is what was moved to Trash.</p>
    <div class="stats">
      <div class="stat"><div class="sv">${messageCount.toLocaleString()}</div><div class="sl">Emails trashed</div></div>
      <div class="stat"><div class="sv">${size}</div><div class="sl">Storage freed</div></div>
    </div>
    <p><strong>Category:</strong> ${catLabel}</p>
    <div class="warn"><p><strong>Undo available:</strong> You can restore this cleanup until <strong>${expiry}</strong>.</p></div>
    <div style="text-align:center;margin:22px 0">
      <a href="${APP_URL}/dashboard" class="btn-o">View Cleanup History</a>
    </div>
  `);

  await sendEmail({
    to: email,
    subject: `${messageCount} emails cleaned (${size} recovered)`,
    html,
    text: `Cleanup complete: ${messageCount} emails moved to Trash, ${size} recovered. Undo by ${expiry}. ${APP_URL}/dashboard`,
  });
}

async function sendQuotaWarningEmail(email, displayName, { lifetimeUsed, lifetimeAllowance }) {
  const name = (displayName || 'there').split(' ')[0];
  const remaining = Math.max(0, lifetimeAllowance - lifetimeUsed);
  const pct = Math.min(100, Math.round((lifetimeUsed / Math.max(1, lifetimeAllowance)) * 100));

  const html = shell(`
    <h1>You have used ${pct}% of your free credits</h1>
    <p>Hi ${name}, your free cleanup credits are running low.</p>
    <div class="stats">
      <div class="stat"><div class="sv" style="color:#D97706">${remaining}</div><div class="sl">Credits remaining</div></div>
      <div class="stat"><div class="sv">${lifetimeUsed}</div><div class="sl">Credits used</div></div>
    </div>
    <div class="warn"><p>When free credits reach zero, choose Starter, Pro, or Power to continue cleanup.</p></div>
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/pricing" class="btn">View Plans</a>
    </div>
  `);

  await sendEmail({
    to: email,
    subject: `Only ${remaining} free cleanup credits remaining`,
    html,
    text: `You have used ${pct}% of free credits (${remaining} left). View plans: ${APP_URL}/pricing`,
  });
}

// Kept name for backward compatibility with existing call sites.
async function sendProUpgradeEmail(email, displayName, periodEnd, planType = 'pro') {
  const name = (displayName || 'there').split(' ')[0];
  const plan = String(planType || 'pro').toLowerCase();
  const label = plan === 'starter' ? 'Starter' : plan === 'power' ? 'Power' : 'Pro';
  const expiry = periodEnd
    ? new Date(periodEnd).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const html = shell(`
    <h1>${label} plan activated</h1>
    <p>Thanks, ${name}. Your ${label} plan is now active.</p>
    <div class="ok"><p><strong>Plan benefits:</strong> more cleanup capacity is now unlocked for your account.</p></div>
    ${expiry ? `<p>Plan period end: <strong>${expiry}</strong>.</p>` : ''}
    <div style="text-align:center;margin:26px 0">
      <a href="${APP_URL}/dashboard" class="btn">Continue Cleanup</a>
    </div>
  `);

  await sendEmail({
    to: email,
    subject: `${label} plan activated`,
    html,
    text: `${label} plan activated. Continue cleanup: ${APP_URL}/dashboard`,
  });
}

async function sendQuotaWarningIfNeeded(userId, email, displayName, lifetimeUsed, lifetimeAllowance) {
  try {
    if (!userId || !email || !lifetimeAllowance) return;

    const threshold = Math.floor(lifetimeAllowance * 0.8);
    if (lifetimeUsed < threshold) return;

    const check = await query('SELECT quota_warning_sent FROM user_quota WHERE user_id = $1', [userId]);
    if (check.rows[0]?.quota_warning_sent) return;

    await sendQuotaWarningEmail(email, displayName, { lifetimeUsed, lifetimeAllowance });
    await query('UPDATE user_quota SET quota_warning_sent = TRUE, updated_at = NOW() WHERE user_id = $1', [userId]);
  } catch (err) {
    logger.warn('emailService: sendQuotaWarningIfNeeded failed', { userId, error: err.message });
  }
}

async function sendQuotaExhaustedIfNeeded(userId, email, displayName) {
  try {
    if (!userId || !email) return;

    const check = await query('SELECT quota_exhausted_sent FROM user_quota WHERE user_id = $1', [userId]);
    if (check.rows[0]?.quota_exhausted_sent) return;

    const name = (displayName || 'there').split(' ')[0];
    const html = shell(`
      <h1>Your free credits are exhausted</h1>
      <p>Hi ${name}, you have used all free cleanup credits.</p>
      <div class="warn"><p>Choose Starter, Pro, or Power to continue deleting emails.</p></div>
      <div style="text-align:center;margin:26px 0">
        <a href="${APP_URL}/pricing" class="btn">Unlock Cleanup</a>
      </div>
    `);

    await sendEmail({
      to: email,
      subject: 'Free cleanup credits exhausted',
      html,
      text: `Your free cleanup credits are exhausted. View plans: ${APP_URL}/pricing`,
    });

    await query('UPDATE user_quota SET quota_exhausted_sent = TRUE, updated_at = NOW() WHERE user_id = $1', [userId]);
  } catch (err) {
    logger.warn('emailService: sendQuotaExhaustedIfNeeded failed', { userId, error: err.message });
  }
}

module.exports = {
  sendWelcomeEmail,
  sendCleanupReceipt,
  sendQuotaWarningEmail,
  sendQuotaWarningIfNeeded,
  sendQuotaExhaustedIfNeeded,
  sendProUpgradeEmail,
};
