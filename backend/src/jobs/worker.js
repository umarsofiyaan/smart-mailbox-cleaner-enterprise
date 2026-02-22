// src/jobs/worker.js
// DB-backed job queue worker + scheduled cron tasks.
// No Redis required.

const { query } = require('../config/database');
const { runScan } = require('../services/scanEngine');
const { getOAuthTokens } = require('../services/tokenService');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 10000;   // job queue poll: every 10s
const CRON_INTERVAL_MS = 60000;   // cron check: every 60s (checks if tasks need to run)
const MAX_CONCURRENT_JOBS = 3;

let activeJobs = 0;
let isRunning = false;

// ─── Job Queue Worker ─────────────────────────────────────────────────────────

function startWorker() {
  if (isRunning) return;
  isRunning = true;
  logger.info('Background job worker started');
  poll();
  startCron();
}

async function poll() {
  if (!isRunning) return;
  if (activeJobs < MAX_CONCURRENT_JOBS) {
    await processNextJob();
  }
  setTimeout(poll, POLL_INTERVAL_MS);
}

async function processNextJob() {
  let job = null;
  try {
    const result = await query(
      `UPDATE jobs
       SET status = 'running', started_at = NOW(), attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
         WHERE status = 'queued'
           AND attempts < max_attempts
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );

    if (result.rows.length === 0) return;
    job = result.rows[0];

    activeJobs++;
    logger.info('Processing job', { jobId: job.id, type: job.job_type });

    await executeJob(job);

    await query(
      "UPDATE jobs SET status = 'complete', completed_at = NOW() WHERE id = $1",
      [job.id]
    );

    logger.info('Job complete', { jobId: job.id });

  } catch (err) {
    logger.error('Job failed', err, { jobId: job?.id });

    if (job) {
      const nextStatus = job.attempts >= job.max_attempts ? 'failed' : 'queued';
      const backoffMinutes = Math.pow(2, job.attempts);

      await query(
        `UPDATE jobs
         SET status = $1,
             error_message = $2,
             scheduled_at = NOW() + ($3 || ' minutes')::interval
         WHERE id = $4`,
        [nextStatus, err.message, backoffMinutes, job.id]
      );
    }
  } finally {
    if (job) activeJobs--;
  }
}

async function executeJob(job) {
  const { job_type, payload, user_id } = job;

  switch (job_type) {
    case 'SCAN': {
      const { scanId, scanDepth } = payload;
      const tokens = await getOAuthTokens(user_id);

      await query(
        "UPDATE scans SET status = 'running' WHERE id = $1",
        [scanId]
      );

      await runScan(scanId, user_id, tokens, scanDepth || '12months');
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job_type}`);
  }
}

async function enqueueScan(userId, scanId, scanDepth = '12months') {
  await query(
    `INSERT INTO jobs (user_id, job_type, payload, status)
     VALUES ($1, 'SCAN', $2, 'queued')`,
    [userId, JSON.stringify({ scanId, scanDepth })]
  );
}

// ─── Scheduled Cron Tasks ─────────────────────────────────────────────────────
// Runs every 60s and checks which scheduled tasks are due.
// No external scheduler (no node-cron dependency) — uses simple time tracking.

let lastDailyQuotaReset = null;       // tracks last midnight UTC reset run
let lastExpiredSubCleanup = null;     // tracks last expired subscription cleanup

function startCron() {
  logger.info('Cron scheduler started');
  runCronTasks(); // run immediately on startup to catch any missed runs
  setInterval(runCronTasks, CRON_INTERVAL_MS);
}

async function runCronTasks() {
  try {
    const now = new Date();

    // ── Task 1: Daily quota reset at midnight UTC ─────────────────────────
    // Fires once per calendar day UTC. Resets daily_used=0 for all free users
    // whose lifetime quota is exhausted and whose daily_reset_at has passed.
    const todayUTC = getUTCDayKey(now);
    if (lastDailyQuotaReset !== todayUTC) {
      await runDailyQuotaReset();
      lastDailyQuotaReset = todayUTC;
    }

    // ── Task 2: Downgrade expired cancelled subscriptions ─────────────────
    // Fires every hour. Finds subscriptions that were cancelled but still had
    // a grace period (current_period_end in the future). Once that date
    // passes, downgrades plan to 'free'.
    const lastHour = getHourKey(now);
    if (lastExpiredSubCleanup !== lastHour) {
      await runExpiredSubscriptionCleanup();
      lastExpiredSubCleanup = lastHour;
    }

  } catch (err) {
    logger.error('Cron task error', err);
  }
}

// ── Quota Reset ───────────────────────────────────────────────────────────────

async function runDailyQuotaReset() {
  try {
    // Reset daily_used for all free users whose:
    // 1. lifetime is exhausted (lifetime_used >= lifetime_allowance)
    // 2. daily_reset_at has passed (it's a new day)
    const result = await query(
      `UPDATE user_quota
       SET daily_used             = 0,
           daily_quota_granted_at = NOW(),
           daily_reset_at         = DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day',
           updated_at             = NOW()
       WHERE lifetime_used >= lifetime_allowance
         AND (daily_reset_at IS NULL OR daily_reset_at <= NOW())
       RETURNING user_id`
    );

    if (result.rowCount > 0) {
      logger.info('Daily quota reset complete', {
        usersReset: result.rowCount,
        userIds: result.rows.map(r => r.user_id),
      });
    }
  } catch (err) {
    logger.error('Daily quota reset failed', err);
  }
}

// ── Expired Subscription Cleanup ──────────────────────────────────────────────

async function runExpiredSubscriptionCleanup() {
  try {
    // Find subscriptions that are 'canceled' but plan still shows 'pro'
    // and current_period_end has now passed → downgrade to free.
    const result = await query(
      `UPDATE subscription_status
       SET plan       = 'free',
           updated_at = NOW()
       WHERE status = 'canceled'
         AND plan   = 'pro'
         AND current_period_end IS NOT NULL
         AND current_period_end < NOW()
       RETURNING user_id, current_period_end`
    );

    if (result.rowCount > 0) {
      logger.info('Expired subscription cleanup: downgraded to free', {
        count: result.rowCount,
        users: result.rows.map(r => ({
          userId: r.user_id,
          expiredAt: r.current_period_end,
        })),
      });
    }
  } catch (err) {
    logger.error('Expired subscription cleanup failed', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Returns a string like "2026-02-22" — used to deduplicate daily cron runs
function getUTCDayKey(date) {
  return date.toISOString().slice(0, 10);
}

// Returns a string like "2026-02-22T03" — used to deduplicate hourly cron runs
function getHourKey(date) {
  return date.toISOString().slice(0, 13);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

function stopWorker() {
  isRunning = false;
  logger.info('Background worker stopped');
}

module.exports = { startWorker, stopWorker, enqueueScan };
