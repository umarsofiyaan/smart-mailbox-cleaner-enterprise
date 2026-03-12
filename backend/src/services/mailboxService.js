const { query, getClient } = require('../config/database');
const { encrypt } = require('../utils/encryption');

function isPowerActive(row) {
  return row?.plan_type === 'power' && row?.plan_expiry && new Date(row.plan_expiry) > new Date();
}

async function writeMailboxEvent(db, {
  userId,
  mailboxId = null,
  googleAccountId = null,
  googleEmail = null,
  eventType,
  actorUserId = null,
  actorEmail = null,
  actorRole = 'user',
  metadata = {},
}) {
  if (!userId || !eventType) return;
  await db.query(
    `INSERT INTO mailbox_link_events
      (user_id, mailbox_id, google_account_id, google_email, event_type, actor_user_id, actor_email, actor_role, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      userId,
      mailboxId,
      googleAccountId,
      googleEmail,
      eventType,
      actorUserId,
      actorEmail,
      actorRole,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function getMailboxLimit(userId) {
  const res = await query(
    `SELECT plan_type, plan_expiry
     FROM users
     WHERE id = $1`,
    [userId]
  );
  const row = res.rows[0] || {};
  return isPowerActive(row) ? 5 : 1;
}

async function ensurePrimaryMailbox(userId) {
  const existing = await query(
    `SELECT id
     FROM connected_mailboxes
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );
  if (existing.rows[0]) return;

  const source = await query(
    `SELECT u.google_id, u.email, o.access_token, o.refresh_token, o.token_expiry, o.scopes
     FROM users u
     LEFT JOIN oauth_tokens o ON o.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );

  const row = source.rows[0];
  if (!row?.google_id || !row?.email || !row?.access_token || !row?.refresh_token) return;

  await query(
    `INSERT INTO connected_mailboxes
       (user_id, google_account_id, google_email, access_token, refresh_token, token_expiry, scopes, is_primary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active')
     ON CONFLICT (user_id, google_account_id) DO UPDATE
       SET google_email = EXCLUDED.google_email,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           token_expiry = EXCLUDED.token_expiry,
           scopes = EXCLUDED.scopes,
           is_primary = TRUE,
           status = 'active',
           updated_at = NOW()`,
    [userId, row.google_id, row.email, row.access_token, row.refresh_token, row.token_expiry, row.scopes || []]
  );
}

async function listConnectedMailboxes(userId) {
  await ensurePrimaryMailbox(userId);
  const [rows, limit] = await Promise.all([
    query(
      `SELECT id, google_account_id, google_email, is_primary, status, created_at
       FROM connected_mailboxes
       WHERE user_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [userId]
    ),
    getMailboxLimit(userId),
  ]);

  return {
    limit,
    items: rows.rows.map((r) => ({
      id: r.id,
      google_account_id: r.google_account_id,
      google_email: r.google_email,
      is_primary: !!r.is_primary,
      status: r.status,
      created_at: r.created_at,
    })),
  };
}

async function resolveMailboxForUser(userId, mailboxId = null) {
  await ensurePrimaryMailbox(userId);
  if (mailboxId) {
    const res = await query(
      `SELECT id, google_account_id, google_email, is_primary
       FROM connected_mailboxes
       WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [mailboxId, userId]
    );
    if (!res.rows[0]) {
      throw new Error('Mailbox not found.');
    }
    return res.rows[0];
  }

  const primary = await query(
    `SELECT id, google_account_id, google_email, is_primary
     FROM connected_mailboxes
     WHERE user_id = $1 AND status = 'active'
     ORDER BY is_primary DESC, created_at ASC
     LIMIT 1`,
    [userId]
  );
  if (!primary.rows[0]) throw new Error('No connected mailbox found.');
  return primary.rows[0];
}

async function upsertConnectedMailbox(
  userId,
  profile,
  tokens,
  { makePrimary = false, actorUserId = null, actorEmail = null, actorRole = 'user' } = {}
) {
  const accountId = String(profile?.id || '').trim();
  const email = String(profile?.email || '').trim().toLowerCase();
  if (!accountId || !email) throw new Error('Invalid Google mailbox profile.');
  if (!tokens?.access_token || !tokens?.refresh_token) throw new Error('Missing mailbox tokens.');

  await ensurePrimaryMailbox(userId);

  const existing = await query(
    `SELECT id, status, is_primary, google_email
     FROM connected_mailboxes
     WHERE user_id = $1 AND google_account_id = $2`,
    [userId, accountId]
  );

  let activeMailboxCount = 0;
  if (!existing.rows[0]) {
    const currentCountRes = await query(
      `SELECT COUNT(*)::int AS c
       FROM connected_mailboxes
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    activeMailboxCount = Number(currentCountRes.rows[0]?.c || 0);
    const limit = await getMailboxLimit(userId);
    if (activeMailboxCount >= limit) {
      throw new Error(`MAILBOX_LIMIT_REACHED:${limit}`);
    }
  }

  // Keep the existing primary mailbox unless this is the very first active
  // mailbox for the user or the caller explicitly requested promotion.
  const shouldBecomePrimary = makePrimary
    || Boolean(existing.rows[0]?.is_primary)
    || (!existing.rows[0] && activeMailboxCount === 0);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (shouldBecomePrimary) {
      await client.query(
        `UPDATE connected_mailboxes
         SET is_primary = FALSE, updated_at = NOW()
         WHERE user_id = $1`,
        [userId]
      );
    }

    const expiry = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);
    const inserted = await client.query(
      `INSERT INTO connected_mailboxes
         (user_id, google_account_id, google_email, access_token, refresh_token, token_expiry, scopes, is_primary, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       ON CONFLICT (user_id, google_account_id) DO UPDATE
         SET google_email = EXCLUDED.google_email,
             access_token = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             token_expiry = EXCLUDED.token_expiry,
             scopes = EXCLUDED.scopes,
             is_primary = EXCLUDED.is_primary,
             status = 'active',
             updated_at = NOW()
       RETURNING id, google_account_id, google_email, is_primary`,
      [
        userId,
        accountId,
        email,
        encrypt(tokens.access_token),
        encrypt(tokens.refresh_token),
        expiry,
        tokens.scope ? tokens.scope.split(' ') : [],
        shouldBecomePrimary,
      ]
    );

    if (inserted.rows[0]?.is_primary) {
      await client.query(
        `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_expiry, scopes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET access_token = $2,
               refresh_token = $3,
               token_expiry = $4,
               scopes = $5,
               updated_at = NOW()`,
        [
          userId,
          encrypt(tokens.access_token),
          encrypt(tokens.refresh_token),
          expiry,
          tokens.scope ? tokens.scope.split(' ') : [],
        ]
      );
    }

    const mailbox = inserted.rows[0];
    const prev = existing.rows[0] || null;
    const linkEventType = !prev
      ? 'connected'
      : (prev.status === 'active' ? null : 'reconnected');
    if (linkEventType) {
      await writeMailboxEvent(client, {
        userId,
        mailboxId: mailbox.id,
        googleAccountId: mailbox.google_account_id,
        googleEmail: mailbox.google_email,
        eventType: linkEventType,
        actorUserId: actorUserId || userId,
        actorEmail,
        actorRole,
      });
    }

    if (mailbox?.is_primary && (!prev || !prev.is_primary || makePrimary)) {
      await writeMailboxEvent(client, {
        userId,
        mailboxId: mailbox.id,
        googleAccountId: mailbox.google_account_id,
        googleEmail: mailbox.google_email,
        eventType: 'set_primary',
        actorUserId: actorUserId || userId,
        actorEmail,
        actorRole,
      });
    }

    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function setPrimaryMailbox(userId, mailboxId, { actorUserId = null, actorEmail = null, actorRole = 'user' } = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const target = await client.query(
      `SELECT id, google_account_id, google_email, access_token, refresh_token, token_expiry, scopes
       FROM connected_mailboxes
       WHERE id = $1 AND user_id = $2 AND status = 'active'
       FOR UPDATE`,
      [mailboxId, userId]
    );
    if (!target.rows[0]) throw new Error('Mailbox not found.');

    await client.query(
      `UPDATE connected_mailboxes
       SET is_primary = CASE WHEN id = $2 THEN TRUE ELSE FALSE END,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, mailboxId]
    );

    const row = target.rows[0];
    await client.query(
      `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_expiry, scopes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET access_token = $2,
             refresh_token = $3,
             token_expiry = $4,
             scopes = $5,
             updated_at = NOW()`,
      [userId, row.access_token, row.refresh_token, row.token_expiry, row.scopes || []]
    );

    await writeMailboxEvent(client, {
      userId,
      mailboxId: row.id,
      googleAccountId: row.google_account_id,
      googleEmail: row.google_email,
      eventType: 'set_primary',
      actorUserId: actorUserId || userId,
      actorEmail,
      actorRole,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function removeMailbox(userId, mailboxId, { actorUserId = null, actorEmail = null, actorRole = 'user' } = {}) {
  await ensurePrimaryMailbox(userId);
  const rows = await query(
    `SELECT id, is_primary, google_account_id, google_email
     FROM connected_mailboxes
     WHERE user_id = $1 AND status = 'active'
     ORDER BY created_at ASC`,
    [userId]
  );
  if (rows.rows.length <= 1) {
    throw new Error('At least one mailbox must remain connected.');
  }

  const target = rows.rows.find((r) => r.id === mailboxId);
  if (!target) throw new Error('Mailbox not found.');

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM connected_mailboxes
       WHERE id = $1 AND user_id = $2`,
      [mailboxId, userId]
    );

    if (target.is_primary) {
      const replacement = await client.query(
        `SELECT id, google_account_id, google_email, access_token, refresh_token, token_expiry, scopes
         FROM connected_mailboxes
         WHERE user_id = $1 AND status = 'active'
         ORDER BY created_at ASC
         LIMIT 1`,
        [userId]
      );
      const next = replacement.rows[0];
      if (next) {
        await client.query(
          `UPDATE connected_mailboxes
           SET is_primary = CASE WHEN id = $2 THEN TRUE ELSE FALSE END,
               updated_at = NOW()
           WHERE user_id = $1`,
          [userId, next.id]
        );
        await client.query(
          `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, token_expiry, scopes)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE
             SET access_token = $2,
                 refresh_token = $3,
                 token_expiry = $4,
                 scopes = $5,
                 updated_at = NOW()`,
          [userId, next.access_token, next.refresh_token, next.token_expiry, next.scopes || []]
        );
        await writeMailboxEvent(client, {
          userId,
          mailboxId: next.id,
          googleAccountId: next.google_account_id,
          googleEmail: next.google_email,
          eventType: 'auto_primary_switch',
          actorUserId: actorUserId || userId,
          actorEmail,
          actorRole,
          metadata: { reason: 'previous_primary_removed' },
        });
      }
    }

    await writeMailboxEvent(client, {
      userId,
      mailboxId: target.id,
      googleAccountId: target.google_account_id,
      googleEmail: target.google_email,
      eventType: 'disconnected',
      actorUserId: actorUserId || userId,
      actorEmail,
      actorRole,
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getMailboxLimit,
  listConnectedMailboxes,
  resolveMailboxForUser,
  ensurePrimaryMailbox,
  upsertConnectedMailbox,
  setPrimaryMailbox,
  removeMailbox,
};
