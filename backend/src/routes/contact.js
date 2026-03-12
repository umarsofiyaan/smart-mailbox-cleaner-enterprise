// src/routes/contact.js
// Public contact form endpoint — no auth required.
// Forwards submissions to support@umarsofiyaan.shop via Resend.

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const RESEND_API = 'https://api.resend.com/emails';
const API_KEY    = process.env.RESEND_API_KEY;
const FROM       = process.env.EMAIL_FROM || 'Smart Mailbox Cleaner <noreply@mailboxcleaner.umarsofiyaan.shop>';
const SUPPORT    = 'support@umarsofiyaan.shop';

// Rate limit: max 3 contact form submissions per IP per hour
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many messages sent. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const SUBJECTS = {
  general:      'General Question',
  billing:      'Billing / Payment',
  bug:          'Bug Report',
  feature:      'Feature Request',
  account:      'Account Issue',
  other:        'Other',
};

// POST /contact
router.post('/', contactLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body || {};

  // Basic validation
  if (!name?.trim())    return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim())   return res.status(400).json({ error: 'Email is required.' });
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Invalid email address.' });
  if (message.trim().length < 10) return res.status(400).json({ error: 'Message is too short.' });
  if (message.trim().length > 5000) return res.status(400).json({ error: 'Message is too long (max 5000 characters).' });

  const subjectLabel = SUBJECTS[subject] || 'General Question';
  const safeSubject = `[Contact Form] ${subjectLabel} — ${name.trim()}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
      <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h2 style="margin: 0 0 4px; font-size: 18px; color: #0f172a;">New Contact Form Submission</h2>
        <p style="margin: 0; font-size: 13px; color: #64748b;">Smart Mailbox Cleaner · ${new Date().toUTCString()}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 24px;">
        <tr>
          <td style="padding: 10px 12px; background: #f1f5f9; border-radius: 6px 6px 0 0; font-weight: 600; color: #475569; width: 120px;">Name</td>
          <td style="padding: 10px 12px; background: #f8fafc; border-radius: 6px 6px 0 0; color: #0f172a;">${escHtml(name.trim())}</td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #f1f5f9; font-weight: 600; color: #475569;">Email</td>
          <td style="padding: 10px 12px; background: #fff; color: #2563eb;">
            <a href="mailto:${escHtml(email.trim())}" style="color: #2563eb;">${escHtml(email.trim())}</a>
          </td>
        </tr>
        <tr>
          <td style="padding: 10px 12px; background: #f1f5f9; border-radius: 0 0 6px 6px; font-weight: 600; color: #475569;">Subject</td>
          <td style="padding: 10px 12px; background: #f8fafc; border-radius: 0 0 6px 6px; color: #0f172a;">${escHtml(subjectLabel)}</td>
        </tr>
      </table>

      <div style="background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px;">
        <p style="margin: 0 0 8px; font-weight: 600; font-size: 13px; color: #475569; text-transform: uppercase; letter-spacing: 0.05em;">Message</p>
        <p style="margin: 0; font-size: 14px; color: #0f172a; line-height: 1.7; white-space: pre-wrap;">${escHtml(message.trim())}</p>
      </div>

      <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8;">
          Reply directly to this email to respond to ${escHtml(name.trim())} at ${escHtml(email.trim())}.
        </p>
      </div>
    </div>
  `;

  // Auto-reply to the user
  const autoReplyHtml = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px 24px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <img src="https://smart-mailbox-cleaner.umarsofiyaan.shop/icon-72.png" alt="Smart Mailbox Cleaner" style="width: 56px; height: 56px; border-radius: 12px;" />
        <h1 style="margin: 16px 0 4px; font-size: 22px; color: #0f172a;">We got your message!</h1>
        <p style="margin: 0; color: #64748b; font-size: 14px;">We'll get back to you within 1–2 business days.</p>
      </div>

      <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 24px; font-size: 14px; color: #475569; line-height: 1.6;">
        <p style="margin: 0 0 8px;"><strong>Your message:</strong></p>
        <p style="margin: 0; white-space: pre-wrap; color: #64748b;">${escHtml(message.trim())}</p>
      </div>

      <p style="font-size: 13px; color: #94a3b8; text-align: center;">
        Smart Mailbox Cleaner · <a href="https://smart-mailbox-cleaner.umarsofiyaan.shop" style="color: #2563eb;">smart-mailbox-cleaner.umarsofiyaan.shop</a>
      </p>
    </div>
  `;

  if (!API_KEY) {
    logger.warn('contact: RESEND_API_KEY not set — email skipped', { name, email, subject });
    return res.json({ success: true });
  }

  try {
    // Send to support inbox
    await sendEmail({
      from: FROM,
      to:   SUPPORT,
      replyTo: email.trim(),
      subject: safeSubject,
      html,
    });

    // Send auto-reply to user
    await sendEmail({
      from:    FROM,
      to:      email.trim(),
      subject: `We received your message — Smart Mailbox Cleaner`,
      html:    autoReplyHtml,
    });

    logger.info('Contact form submitted', { name, email, subject: subjectLabel });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Contact form email failed', err, { email });
    return res.status(500).json({ error: 'Failed to send message. Please try again or email us directly.' });
  }
});

async function sendEmail({ from, to, replyTo, subject, html }) {
  const body = { from, to, subject, html };
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch(RESEND_API, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
  return res.json();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
