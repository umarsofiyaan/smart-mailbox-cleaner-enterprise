const { query } = require('../config/database');
const { getOAuthTokens } = require('./tokenService');
const {
  getGmailClient,
  collectMessageIdsByQuery,
  batchGetMessageMetadata,
} = require('./gmailService');
const { checkQuota, consumeQuota } = require('./quotaService');
const { executeCleanup } = require('./cleanupService');
const logger = require('../utils/logger');

function normalizeSafetyRules(input = {}) {
  return {
    exclude_starred: input.exclude_starred !== false,
    exclude_important: input.exclude_important === true,
    exclude_replied_threads: input.exclude_replied_threads === true,
  };
}

function buildEffectiveQuery(baseQuery, safetyRules) {
  const safeParts = [];
  if (safetyRules.exclude_starred) safeParts.push('-is:starred');
  if (safetyRules.exclude_important) safeParts.push('-is:important');
  safeParts.push('-in:trash -in:spam');
  return [baseQuery, ...safeParts].join(' ').trim();
}

function parseUtcTime(value) {
  const m = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!m) return { hour: 3, minute: 0 };
  return { hour: Math.min(23, parseInt(m[1], 10)), minute: Math.min(59, parseInt(m[2], 10)) };
}

function computeNextRunAt(frequency, runAtUtc, dayOfWeek) {
  if (frequency === 'none') return null;

  const now = new Date();
  const { hour, minute } = parseUtcTime(runAtUtc);
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    minute,
    0,
    0
  ));

  if (frequency === 'daily') {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (frequency === 'weekly') {
    const target = Number.isInteger(dayOfWeek) ? dayOfWeek : now.getUTCDay();
    let delta = target - next.getUTCDay();
    if (delta < 0) delta += 7;
    next.setUTCDate(next.getUTCDate() + delta);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  return null;
}

function extractSenderEmail(fromHeader = '') {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match?.[1]) return match[1].trim().toLowerCase();
  return fromHeader.trim().toLowerCase();
}

function toSenderDomain(email = '') {
  const idx = email.lastIndexOf('@');
  return idx > -1 ? email.slice(idx + 1) : '';
}

async function createPlaybook(userId, payload) {
  const safety = normalizeSafetyRules(payload.safety_rules);
  const frequency = payload.schedule?.frequency || 'none';
  const runAtUtc = payload.schedule?.run_at_utc || '03:00';
  const dayOfWeek = Number.isInteger(payload.schedule?.day_of_week) ? payload.schedule.day_of_week : null;
  const isScheduleActive = frequency !== 'none';
  const nextRunAt = computeNextRunAt(frequency, runAtUtc, dayOfWeek);

  const created = await query(
    `INSERT INTO playbooks (user_id, name, query, safety_rules, action_mode, is_active)
     VALUES ($1, $2, $3, $4, 'trash', $5)
     RETURNING id, user_id, name, query, safety_rules, action_mode, is_active, created_at, updated_at`,
    [userId, payload.name, payload.query, JSON.stringify(safety), payload.is_active !== false]
  );

  const playbook = created.rows[0];
  await query(
    `INSERT INTO playbook_schedules (playbook_id, frequency, day_of_week, run_at_utc, next_run_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (playbook_id) DO UPDATE
     SET frequency = $2, day_of_week = $3, run_at_utc = $4, next_run_at = $5, is_active = $6, updated_at = NOW()`,
    [playbook.id, frequency, dayOfWeek, runAtUtc, nextRunAt, isScheduleActive]
  );

  return playbook;
}

async function listPlaybooks(userId) {
  const result = await query(
    `SELECT p.id, p.name, p.query, p.safety_rules, p.action_mode, p.is_active, p.created_at, p.updated_at,
            s.frequency, s.day_of_week, s.run_at_utc, s.next_run_at, s.last_run_at, s.is_active AS schedule_active
     FROM playbooks p
     LEFT JOIN playbook_schedules s ON s.playbook_id = p.id
     WHERE p.user_id = $1
     ORDER BY p.created_at DESC`,
    [userId]
  );
  return result.rows;
}

async function updatePlaybook(userId, playbookId, payload) {
  const existing = await query(
    'SELECT id, safety_rules FROM playbooks WHERE id = $1 AND user_id = $2',
    [playbookId, userId]
  );
  if (!existing.rows[0]) throw new Error('Playbook not found.');

  const safety = payload.safety_rules
    ? normalizeSafetyRules(payload.safety_rules)
    : existing.rows[0].safety_rules;

  const updated = await query(
    `UPDATE playbooks
     SET name = COALESCE($3, name),
         query = COALESCE($4, query),
         safety_rules = $5,
         is_active = COALESCE($6, is_active),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, query, safety_rules, action_mode, is_active, created_at, updated_at`,
    [playbookId, userId, payload.name || null, payload.query || null, JSON.stringify(safety), payload.is_active]
  );

  if (payload.schedule) {
    const frequency = payload.schedule.frequency || 'none';
    const runAtUtc = payload.schedule.run_at_utc || '03:00';
    const dayOfWeek = Number.isInteger(payload.schedule.day_of_week) ? payload.schedule.day_of_week : null;
    const isScheduleActive = frequency !== 'none';
    const nextRunAt = computeNextRunAt(frequency, runAtUtc, dayOfWeek);

    await query(
      `INSERT INTO playbook_schedules (playbook_id, frequency, day_of_week, run_at_utc, next_run_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (playbook_id) DO UPDATE
       SET frequency = $2, day_of_week = $3, run_at_utc = $4, next_run_at = $5, is_active = $6, updated_at = NOW()`,
      [playbookId, frequency, dayOfWeek, runAtUtc, nextRunAt, isScheduleActive]
    );
  }

  return updated.rows[0];
}

async function getPlaybook(userId, playbookId) {
  const result = await query(
    `SELECT p.id, p.user_id, p.name, p.query, p.safety_rules, p.action_mode, p.is_active,
            s.frequency, s.day_of_week, s.run_at_utc, s.next_run_at, s.last_run_at, s.is_active AS schedule_active
     FROM playbooks p
     LEFT JOIN playbook_schedules s ON s.playbook_id = p.id
     WHERE p.id = $1 AND p.user_id = $2`,
    [playbookId, userId]
  );
  return result.rows[0] || null;
}

async function previewPlaybook(userId, playbookId) {
  const playbook = await getPlaybook(userId, playbookId);
  if (!playbook) throw new Error('Playbook not found.');

  const tokens = await getOAuthTokens(userId);
  const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken);
  const effectiveQuery = buildEffectiveQuery(playbook.query, playbook.safety_rules || {});
  const quota = await checkQuota(userId);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: effectiveQuery,
    fields: 'resultSizeEstimate',
  });
  const rawEstimate = listRes.data.resultSizeEstimate || 0;
  const effectiveCap = quota.allowed ? quota.remaining : 0;
  const matchedCount = Number.isFinite(effectiveCap) ? Math.min(rawEstimate, effectiveCap) : rawEstimate;

  const sampleIds = await collectMessageIdsByQuery(gmail, effectiveQuery, { maxMessages: Math.min(200, matchedCount) });
  const metadata = sampleIds.length ? await batchGetMessageMetadata(gmail, sampleIds) : [];
  const sampleBytes = metadata.reduce((sum, m) => sum + (m.sizeEstimate || 0), 0);
  const avgBytes = metadata.length ? sampleBytes / metadata.length : 0;
  const estimatedBytes = Math.round(avgBytes * matchedCount);

  const domains = {};
  for (const m of metadata) {
    const email = extractSenderEmail(m.from);
    const domain = toSenderDomain(email);
    if (!domain) continue;
    domains[domain] = (domains[domain] || 0) + 1;
  }
  const topDomains = Object.entries(domains)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    playbookId: playbook.id,
    query: effectiveQuery,
    matchedCount,
    estimatedBytes,
    quotaCapped: Number.isFinite(effectiveCap),
    topDomains,
  };
}

async function enqueuePlaybookRun(userId, playbookId, trigger = 'manual') {
  const existing = await query(
    `SELECT id, playbook_id, user_id, status, created_at
     FROM playbook_runs
     WHERE user_id = $1 AND playbook_id = $2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, playbookId]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const run = await query(
    `INSERT INTO playbook_runs (playbook_id, user_id, status)
     VALUES ($1, $2, 'queued')
     RETURNING id, playbook_id, user_id, status, created_at`,
    [playbookId, userId]
  );
  const runRow = run.rows[0];

  await query(
    `INSERT INTO jobs (user_id, job_type, payload, status)
     VALUES ($1, 'PLAYBOOK_RUN', $2, 'queued')`,
    [userId, JSON.stringify({ runId: runRow.id, playbookId, trigger })]
  );

  return runRow;
}

async function executePlaybookRun(runId, userId, playbookId) {
  await query(
    `UPDATE playbook_runs SET status = 'running', started_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [runId, userId]
  );

  const playbook = await getPlaybook(userId, playbookId);
  if (!playbook) throw new Error('Playbook not found.');

  try {
    const tokens = await getOAuthTokens(userId);
    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken);
    const effectiveQuery = buildEffectiveQuery(playbook.query, playbook.safety_rules || {});
    const quota = await checkQuota(userId);
    const maxMessages = quota.allowed ? quota.remaining : 0;

    const ids = await collectMessageIdsByQuery(gmail, effectiveQuery, { maxMessages });
    const metadata = ids.length ? await batchGetMessageMetadata(gmail, ids.slice(0, Math.min(500, ids.length))) : [];
    const sampleBytes = metadata.reduce((sum, m) => sum + (m.sizeEstimate || 0), 0);
    const avgBytes = metadata.length ? sampleBytes / metadata.length : 0;
    const estimatedBytes = Math.round(avgBytes * ids.length);

    let cleanedCount = 0;
    if (ids.length > 0) {
      const cleanup = await executeCleanup(
        userId,
        null,
        `playbook:${playbook.name}`,
        ids,
        estimatedBytes,
        tokens
      );
      cleanedCount = cleanup.successCount;
      await consumeQuota(userId, cleanedCount);
    }

    await query(
      `UPDATE playbook_runs
       SET status = 'complete',
           matched_count = $2,
           cleaned_count = $3,
           estimated_bytes = $4,
           completed_at = NOW()
       WHERE id = $1`,
      [runId, ids.length, cleanedCount, estimatedBytes]
    );

    if (playbook.schedule_active && playbook.frequency !== 'none') {
      const nextRunAt = computeNextRunAt(playbook.frequency, playbook.run_at_utc, playbook.day_of_week);
      await query(
        `UPDATE playbook_schedules
         SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
         WHERE playbook_id = $1`,
        [playbookId, nextRunAt]
      );
    }
  } catch (err) {
    await query(
      `UPDATE playbook_runs
       SET status = 'failed', error_message = $2, completed_at = NOW()
       WHERE id = $1`,
      [runId, err.message]
    );
    throw err;
  }
}

async function listRuns(userId, limit = 20) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const result = await query(
    `SELECT r.id, r.playbook_id, p.name AS playbook_name, r.status,
            r.matched_count, r.cleaned_count, r.estimated_bytes,
            r.error_message, r.started_at, r.completed_at, r.created_at
     FROM playbook_runs r
     LEFT JOIN playbooks p ON p.id = r.playbook_id
     WHERE r.user_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [userId, safeLimit]
  );
  return result.rows;
}

async function getLatestInsights(userId) {
  const latest = await query(
    `SELECT categories_json
     FROM scans
     WHERE user_id = $1 AND status = 'complete'
     ORDER BY completed_at DESC
     LIMIT 1`,
    [userId]
  );

  const categories = latest.rows[0]?.categories_json || [];
  const domainMap = {};
  for (const cat of categories) {
    for (const msg of (cat.messages || [])) {
      const email = extractSenderEmail(msg.from);
      const domain = toSenderDomain(email);
      if (!domain) continue;
      const size = msg.sizeEstimate || 0;
      if (!domainMap[domain]) {
        domainMap[domain] = { domain, messageCount: 0, totalBytes: 0 };
      }
      domainMap[domain].messageCount += 1;
      domainMap[domain].totalBytes += size;
    }
  }

  return Object.values(domainMap)
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 20);
}

module.exports = {
  createPlaybook,
  listPlaybooks,
  updatePlaybook,
  getPlaybook,
  previewPlaybook,
  enqueuePlaybookRun,
  executePlaybookRun,
  listRuns,
  getLatestInsights,
  buildEffectiveQuery,
};
