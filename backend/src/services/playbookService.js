const { query } = require('../config/database');
const { getOAuthTokens } = require('./tokenService');
const {
  getGmailClient,
  collectMessageIdsByQuery,
  batchGetMessageMetadata,
} = require('./gmailService');
const { checkQuota, consumeQuota } = require('./quotaService');
const { executeCleanup } = require('./cleanupService');

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

function parseTime(value) {
  const m = String(value || '').match(/^(\d{2}):(\d{2})/);
  if (!m) return { hour: 3, minute: 0 };
  return { hour: Math.min(23, parseInt(m[1], 10)), minute: Math.min(59, parseInt(m[2], 10)) };
}

function getTimeZoneOrUtc(value) {
  try {
    if (!value) return 'UTC';
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return 'UTC';
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(date);

  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function naiveUtcMinutes(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000);
}

function localDateTimeToUtc(localParts, timeZone) {
  let utcMillis = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    0,
    0
  );

  for (let i = 0; i < 6; i++) {
    const actual = zonedParts(new Date(utcMillis), timeZone);
    const diffMinutes = naiveUtcMinutes(localParts) - naiveUtcMinutes(actual);
    if (diffMinutes === 0) break;
    utcMillis += diffMinutes * 60000;
  }

  return new Date(utcMillis);
}

function addDaysLocal(parts, days) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function computeNextRunAt(frequency, runAtLocal, dayOfWeek, timeZone) {
  if (frequency === 'none') return null;

  const tz = getTimeZoneOrUtc(timeZone);
  const now = new Date();
  const nowLocal = zonedParts(now, tz);
  const run = parseTime(runAtLocal);

  const nowMinutes = nowLocal.hour * 60 + nowLocal.minute;
  const runMinutes = run.hour * 60 + run.minute;

  let daysToAdd = 0;

  if (frequency === 'daily') {
    if (runMinutes <= nowMinutes) daysToAdd = 1;
  } else if (frequency === 'weekly') {
    const target = Number.isInteger(dayOfWeek) ? dayOfWeek : nowLocal.weekday;
    daysToAdd = target - nowLocal.weekday;
    if (daysToAdd < 0) daysToAdd += 7;
    if (daysToAdd === 0 && runMinutes <= nowMinutes) daysToAdd = 7;
  } else {
    return null;
  }

  const targetDate = addDaysLocal(nowLocal, daysToAdd);
  return localDateTimeToUtc({
    year: targetDate.year,
    month: targetDate.month,
    day: targetDate.day,
    hour: run.hour,
    minute: run.minute,
  }, tz);
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

function summarizeDomainFromMessage(domainMap, msg) {
  const email = extractSenderEmail(msg.from);
  const domain = toSenderDomain(email);
  if (!domain) return;

  if (!domainMap[domain]) {
    domainMap[domain] = { domain, messageCount: 0, totalBytes: 0, messages: [] };
  }

  domainMap[domain].messageCount += 1;
  domainMap[domain].totalBytes += msg.sizeEstimate || 0;

  if (domainMap[domain].messages.length < 25) {
    domainMap[domain].messages.push({
      id: msg.id,
      from: msg.from,
      subject: msg.subject,
      internalDate: msg.internalDate,
      sizeEstimate: msg.sizeEstimate || 0,
      tier: msg.tier,
      score: msg.score,
    });
  }
}

async function createPlaybook(userId, payload) {
  const safety = normalizeSafetyRules(payload.safety_rules);
  const frequency = payload.schedule?.frequency || 'none';
  const runAtUtc = payload.schedule?.run_at_utc || '03:00';
  const timezone = getTimeZoneOrUtc(payload.schedule?.timezone || 'UTC');
  const dayOfWeek = Number.isInteger(payload.schedule?.day_of_week) ? payload.schedule.day_of_week : null;
  const isScheduleActive = frequency !== 'none';
  const nextRunAt = computeNextRunAt(frequency, runAtUtc, dayOfWeek, timezone);

  const created = await query(
    `INSERT INTO playbooks (user_id, name, query, safety_rules, action_mode, version, is_active)
     VALUES ($1, $2, $3, $4, 'trash', 1, $5)
     RETURNING id, user_id, name, query, safety_rules, action_mode, version, is_active, created_at, updated_at`,
    [userId, payload.name, payload.query, JSON.stringify(safety), payload.is_active !== false]
  );

  const playbook = created.rows[0];
  await query(
    `INSERT INTO playbook_schedules (playbook_id, frequency, day_of_week, run_at_utc, timezone, next_run_at, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (playbook_id) DO UPDATE
     SET frequency = $2, day_of_week = $3, run_at_utc = $4, timezone = $5, next_run_at = $6, is_active = $7, updated_at = NOW()`,
    [playbook.id, frequency, dayOfWeek, runAtUtc, timezone, nextRunAt, isScheduleActive]
  );

  return playbook;
}

async function listPlaybooks(userId) {
  const result = await query(
    `SELECT p.id, p.name, p.query, p.safety_rules, p.action_mode, p.version, p.is_active, p.created_at, p.updated_at,
            s.frequency, s.day_of_week, s.run_at_utc, s.timezone, s.next_run_at, s.last_run_at, s.is_active AS schedule_active
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
    'SELECT id, name, query, safety_rules, version FROM playbooks WHERE id = $1 AND user_id = $2',
    [playbookId, userId]
  );
  if (!existing.rows[0]) throw new Error('Playbook not found.');

  const current = existing.rows[0];
  const safety = payload.safety_rules ? normalizeSafetyRules(payload.safety_rules) : current.safety_rules;

  const changedCore = (
    (payload.name && payload.name !== current.name) ||
    (payload.query && payload.query !== current.query) ||
    JSON.stringify(safety) !== JSON.stringify(current.safety_rules)
  );

  const nextVersion = changedCore ? Number(current.version || 1) + 1 : Number(current.version || 1);

  const updated = await query(
    `UPDATE playbooks
     SET name = COALESCE($3, name),
         query = COALESCE($4, query),
         safety_rules = $5,
         version = $6,
         is_active = COALESCE($7, is_active),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, query, safety_rules, action_mode, version, is_active, created_at, updated_at`,
    [playbookId, userId, payload.name || null, payload.query || null, JSON.stringify(safety), nextVersion, payload.is_active]
  );

  if (payload.schedule) {
    const frequency = payload.schedule.frequency || 'none';
    const runAtUtc = payload.schedule.run_at_utc || '03:00';
    const timezone = getTimeZoneOrUtc(payload.schedule.timezone || 'UTC');
    const dayOfWeek = Number.isInteger(payload.schedule.day_of_week) ? payload.schedule.day_of_week : null;
    const isScheduleActive = frequency !== 'none';
    const nextRunAt = computeNextRunAt(frequency, runAtUtc, dayOfWeek, timezone);

    await query(
      `INSERT INTO playbook_schedules (playbook_id, frequency, day_of_week, run_at_utc, timezone, next_run_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (playbook_id) DO UPDATE
       SET frequency = $2, day_of_week = $3, run_at_utc = $4, timezone = $5, next_run_at = $6, is_active = $7, updated_at = NOW()`,
      [playbookId, frequency, dayOfWeek, runAtUtc, timezone, nextRunAt, isScheduleActive]
    );
  }

  return updated.rows[0];
}

async function deletePlaybook(userId, playbookId) {
  const result = await query(
    'DELETE FROM playbooks WHERE id = $1 AND user_id = $2 RETURNING id',
    [playbookId, userId]
  );
  if (!result.rows[0]) throw new Error('Playbook not found.');
  return { id: result.rows[0].id };
}

async function getPlaybook(userId, playbookId) {
  const result = await query(
    `SELECT p.id, p.user_id, p.name, p.query, p.safety_rules, p.action_mode, p.version, p.is_active, p.updated_at,
            s.frequency, s.day_of_week, s.run_at_utc, s.timezone, s.next_run_at, s.last_run_at, s.is_active AS schedule_active
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
  for (const m of metadata) summarizeDomainFromMessage(domains, m);

  const topDomains = Object.values(domains)
    .map((d) => ({ domain: d.domain, count: d.messageCount, messages: d.messages }))
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
  const playbook = await getPlaybook(userId, playbookId);
  if (!playbook) throw new Error('Playbook not found.');

  const existing = await query(
    `SELECT id, playbook_id, user_id, status, created_at
     FROM playbook_runs
     WHERE user_id = $1 AND playbook_id = $2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, playbookId]
  );
  if (existing.rows[0]) return existing.rows[0];

  const run = await query(
    `INSERT INTO playbook_runs (
      playbook_id, user_id, status, trigger_source,
      playbook_name_snapshot, query_snapshot, safety_rules_snapshot,
      playbook_version_snapshot, playbook_updated_at_snapshot
    )
    VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, $8)
    RETURNING id, playbook_id, user_id, status, created_at`,
    [
      playbookId,
      userId,
      trigger,
      playbook.name,
      playbook.query,
      JSON.stringify(playbook.safety_rules || {}),
      playbook.version || 1,
      playbook.updated_at,
    ]
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

  const runResult = await query(
    `SELECT query_snapshot, safety_rules_snapshot, playbook_name_snapshot
     FROM playbook_runs
     WHERE id = $1 AND user_id = $2`,
    [runId, userId]
  );

  const playbook = await getPlaybook(userId, playbookId);
  if (!playbook) throw new Error('Playbook not found.');

  const runRow = runResult.rows[0] || {};

  try {
    const tokens = await getOAuthTokens(userId);
    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken);

    const queryForRun = runRow.query_snapshot || playbook.query;
    const safetyForRun = runRow.safety_rules_snapshot || playbook.safety_rules || {};
    const playbookNameForRun = runRow.playbook_name_snapshot || playbook.name;

    const effectiveQuery = buildEffectiveQuery(queryForRun, safetyForRun);
    const quota = await checkQuota(userId);
    const maxMessages = quota.allowed ? quota.remaining : 0;

    const ids = await collectMessageIdsByQuery(gmail, effectiveQuery, { maxMessages });
    const metadata = ids.length ? await batchGetMessageMetadata(gmail, ids.slice(0, Math.min(1000, ids.length))) : [];
    const sampleBytes = metadata.reduce((sum, m) => sum + (m.sizeEstimate || 0), 0);
    const avgBytes = metadata.length ? sampleBytes / metadata.length : 0;
    const estimatedBytes = Math.round(avgBytes * ids.length);

    let cleanedCount = 0;
    if (ids.length > 0) {
      const cleanup = await executeCleanup(
        userId,
        null,
        `playbook:${playbookNameForRun}`,
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
      const nextRunAt = computeNextRunAt(playbook.frequency, playbook.run_at_utc, playbook.day_of_week, playbook.timezone || 'UTC');
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
    `SELECT r.id, r.playbook_id, p.name AS current_playbook_name, p.updated_at AS current_playbook_updated_at,
            p.version AS current_playbook_version,
            r.status, r.trigger_source, r.playbook_name_snapshot, r.query_snapshot,
            r.safety_rules_snapshot, r.playbook_version_snapshot, r.playbook_updated_at_snapshot,
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
      summarizeDomainFromMessage(domainMap, msg);
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
  deletePlaybook,
  getPlaybook,
  previewPlaybook,
  enqueuePlaybookRun,
  executePlaybookRun,
  listRuns,
  getLatestInsights,
  buildEffectiveQuery,
};
