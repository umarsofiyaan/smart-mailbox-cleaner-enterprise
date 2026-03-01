// src/jobs/worker.js
// DB-backed job queue + scheduled cron tasks. No Redis required.
//
// Cron tasks (no external scheduler — runs every 60s, fires once per period):
//   1. Daily quota reset at midnight UTC
//   2. Expired subscription downgrade (hourly)
//   3. Scan expiry — delete completed scans older than 90 days (daily)

const { query }       = require('../config/database');
const { runScan, runCustomScan } = require('../services/scanEngine');
const { getOAuthTokens } = require('../services/tokenService');
const { executePlaybookRun, enqueuePlaybookRun } = require('../services/playbookService');
const { checkQuota, consumeQuota, getQuotaSummary } = require('../services/quotaService');
const {
  getGmailClient,
  collectMessageIdsByQuery,
  getTrashEstimate,
  getTrashConversationEstimate,
} = require('../services/gmailService');
const { runCleanupAction } = require('../services/cleanupService');
const {
  sendCleanupReceipt,
  sendQuotaWarningIfNeeded,
  sendQuotaExhaustedIfNeeded,
} = require('../services/emailService');
const logger          = require('../utils/logger');

const POLL_INTERVAL_MS = 10000;
const CRON_INTERVAL_MS = 60000;
const MAX_CONCURRENT_JOBS = 3;

let activeJobs = 0;
let isRunning  = false;

// ─── Job queue ────────────────────────────────────────────────────────────────

function startWorker() {
  if (isRunning) return;
  isRunning = true;
  logger.info('Background job worker started');
  poll();
  startCron();
}

async function poll() {
  if (!isRunning) return;
  if (activeJobs < MAX_CONCURRENT_JOBS) await processNextJob();
  setTimeout(poll, POLL_INTERVAL_MS);
}

async function processNextJob() {
  let job = null;
  try {
    const result = await query(
      `UPDATE jobs
       SET status='running', started_at=NOW(), attempts=attempts+1
       WHERE id=(
         SELECT id FROM jobs
         WHERE status='queued' AND attempts<max_attempts AND scheduled_at<=NOW()
         ORDER BY scheduled_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       RETURNING *`
    );
    if (result.rows.length === 0) return;
    job = result.rows[0];
    activeJobs++;
    logger.info('Processing job', { jobId: job.id, type: job.job_type });
    await executeJob(job);
    await query("UPDATE jobs SET status='complete', completed_at=NOW() WHERE id=$1", [job.id]);
    logger.info('Job complete', { jobId: job.id });
  } catch (err) {
    logger.error('Job failed', err, { jobId: job?.id });
    if (job) {
      const nextStatus = job.attempts >= job.max_attempts ? 'failed' : 'queued';
      await query(
        `UPDATE jobs SET status=$1, error_message=$2, scheduled_at=NOW()+($3||' minutes')::interval WHERE id=$4`,
        [nextStatus, err.message, Math.pow(2, job.attempts), job.id]
      );
    }
  } finally {
    if (job) activeJobs--;
  }
}

async function executeJob(job) {
  if (job.job_type === 'SCAN') {
    const { scanId, scanDepth } = job.payload;
    const tokens = await getOAuthTokens(job.user_id);
    await query("UPDATE scans SET status='running' WHERE id=$1", [scanId]);
    await runScan(scanId, job.user_id, tokens, scanDepth || '12months');
  } else if (job.job_type === 'CUSTOM_SCAN') {
    const { scanId, customQuery } = job.payload;
    const tokens = await getOAuthTokens(job.user_id);
    await query("UPDATE scans SET status='running' WHERE id=$1", [scanId]);
    await runCustomScan(scanId, job.user_id, tokens, customQuery);
  } else if (job.job_type === 'PLAYBOOK_RUN') {
    const { runId, playbookId } = job.payload;
    await executePlaybookRun(runId, job.user_id, playbookId);
  } else if (job.job_type === 'CLEANUP') {
    await executeCleanupJob(job);
  } else {
    throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

async function patchJobPayload(jobId, patch) {
  await query(
    `UPDATE jobs
     SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
     WHERE id = $1`,
    [jobId, JSON.stringify(patch)]
  );
}

async function executeCleanupJob(job) {
  const {
    actionId,
    scanId,
    category,
    cleanupMode = 'ids',
    customQuery,
    messageIds = [],
    estimatedBytes = 0,
  } = job.payload || {};

  if (!actionId || !scanId || !category) {
    throw new Error('Invalid CLEANUP job payload.');
  }

  try {
    const quotaCheck = await checkQuota(job.user_id);
    if (!quotaCheck.allowed) {
      await query(
        "UPDATE cleanup_actions SET status = 'failed', error_message = $1 WHERE id = $2",
        [quotaCheck.reason, actionId]
      );
      throw new Error(quotaCheck.reason);
    }

    const tokens = await getOAuthTokens(job.user_id);
    const gmail = getGmailClient(tokens.accessToken, tokens.refreshToken, tokens.tokenExpiry);
    const trashBeforeEstimate = await getTrashEstimate(gmail);
    const trashConversationsBefore = await getTrashConversationEstimate(gmail);
    let effectiveIds = [];

    if (cleanupMode === 'query') {
      await patchJobPayload(job.id, { progress: { stage: 'resolving_ids' } });
      effectiveIds = await collectMessageIdsByQuery(gmail, customQuery, {
        maxMessages: quotaCheck.remaining,
      });
    } else {
      effectiveIds = Array.isArray(messageIds)
        ? messageIds.slice(0, quotaCheck.remaining)
        : [];
    }

    // Guard against repeated IDs from broad/paginated matches.
    effectiveIds = Array.from(new Set(effectiveIds));

    await patchJobPayload(job.id, {
      progress: { stage: 'moving_to_trash', matchedCount: effectiveIds.length },
    });

    if (!effectiveIds.length) {
      await query(
        "UPDATE cleanup_actions SET status = 'failed', error_message = $1 WHERE id = $2",
        ['No matching emails found for cleanup.', actionId]
      );
      throw new Error('No matching emails found for cleanup.');
    }

    const result = await runCleanupAction(
      actionId,
      effectiveIds,
      estimatedBytes,
      tokens,
      tokens.tokenExpiry,
      async ({ movedCount, failedCount, totalCount }) => {
        await patchJobPayload(job.id, {
          progress: {
            stage: 'moving_to_trash',
            matchedCount: effectiveIds.length,
            movedCount,
            failedCount,
            totalCount,
          },
        });
      }
    );
    const trashAfterEstimate = await getTrashEstimate(gmail);
    const trashConversationsAfter = await getTrashConversationEstimate(gmail);
    const estimatedNewInTrash = Math.max(0, trashAfterEstimate - trashBeforeEstimate);
    const estimatedNewConversationsInTrash = Math.max(
      0,
      trashConversationsAfter - trashConversationsBefore
    );

    await consumeQuota(job.user_id, result.successCount);

    await patchJobPayload(job.id, {
      progress: { stage: 'done', matchedCount: effectiveIds.length },
      result: {
        actionId: result.actionId,
        processedCount: effectiveIds.length,
        successCount: result.successCount,
        conversationCount: result.conversationCount || 0,
        sourceQuery: cleanupMode === 'query' ? customQuery : null,
        failedCount: result.failedCount,
        bytesFreed: result.bytesFreed,
        undoExpiresAt: result.undoExpiresAt,
        trashBeforeEstimate,
        trashAfterEstimate,
        estimatedNewInTrash,
        trashConversationsBefore,
        trashConversationsAfter,
        estimatedNewConversationsInTrash,
      },
    });

    setImmediate(async () => {
      try {
        const userResult = await query(
          'SELECT email, display_name FROM users WHERE id = $1',
          [job.user_id]
        );
        if (!userResult.rows[0]) return;

        const { email, display_name } = userResult.rows[0];
        const updatedQuota = await getQuotaSummary(job.user_id);
        const isPro = updatedQuota.isPro;
        const lifetimeUsed = updatedQuota.lifetime?.used ?? 0;
        const lifetimeAllowance = updatedQuota.lifetime?.allowance ?? 5000;
        const quotaRemaining = updatedQuota.lifetime?.remaining ?? 0;

        sendCleanupReceipt(email, display_name, {
          category,
          messageCount: result.successCount,
          bytesFreed: result.bytesFreed,
          undoExpiresAt: result.undoExpiresAt,
          quotaRemaining,
          isPro,
        });

        if (!isPro) {
          sendQuotaWarningIfNeeded(job.user_id, email, display_name, lifetimeUsed, lifetimeAllowance);
          if (quotaRemaining === 0) {
            sendQuotaExhaustedIfNeeded(job.user_id, email, display_name);
          }
        }
      } catch (e) {
        logger.error('Post-cleanup email error', e);
      }
    });
  } catch (err) {
    await query(
      "UPDATE cleanup_actions SET status = 'failed', error_message = $1 WHERE id = $2 AND status = 'pending'",
      [err.message, actionId]
    );
    throw err;
  }
}

async function enqueueScan(userId, scanId, scanDepth = '12months') {
  await query(
    `INSERT INTO jobs (user_id, job_type, payload, status) VALUES ($1,'SCAN',$2,'queued')`,
    [userId, JSON.stringify({ scanId, scanDepth })]
  );
}

// ─── Cron ─────────────────────────────────────────────────────────────────────

let lastDailyReset  = null;
let lastSubCleanup  = null;
let lastScanExpiry  = null;

function startCron() {
  logger.info('Cron scheduler started');
  runCronTasks();
  setInterval(runCronTasks, CRON_INTERVAL_MS);
}

async function runCronTasks() {
  try {
    const now      = new Date();
    const dayKey   = now.toISOString().slice(0, 10);    // "2026-02-22"
    const hourKey  = now.toISOString().slice(0, 13);    // "2026-02-22T14"

    if (lastDailyReset !== dayKey) {
      await runDailyQuotaReset();
      lastDailyReset = dayKey;
    }

    if (lastSubCleanup !== hourKey) {
      await runExpiredSubCleanup();
      lastSubCleanup = hourKey;
    }

    await enqueueDuePlaybookSchedules();

    if (lastScanExpiry !== dayKey) {
      await runScanExpiry();
      lastScanExpiry = dayKey;
    }
  } catch (err) {
    logger.error('Cron error', err);
  }
}

// ── Task 1: Daily quota reset ─────────────────────────────────────────────────

async function runDailyQuotaReset() {
  try {
    const result = await query(
      `UPDATE user_quota
       SET daily_used=0,
           daily_quota_granted_at=NOW(),
           daily_reset_at=DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day',
           updated_at=NOW()
       WHERE lifetime_used >= lifetime_allowance
         AND (daily_reset_at IS NULL OR daily_reset_at <= NOW())
       RETURNING user_id`
    );
    if (result.rowCount > 0) logger.info('Daily quota reset', { count: result.rowCount });
  } catch (err) {
    logger.error('Daily quota reset failed', err);
  }
}

// ── Task 2: Expired subscription downgrade ────────────────────────────────────

async function runExpiredSubCleanup() {
  try {
    const result = await query(
      `UPDATE subscription_status SET plan='free', updated_at=NOW()
       WHERE status='canceled' AND plan='pro'
         AND current_period_end IS NOT NULL AND current_period_end < NOW()
       RETURNING user_id`
    );
    if (result.rowCount > 0) logger.info('Expired subs downgraded', { count: result.rowCount });
  } catch (err) {
    logger.error('Expired sub cleanup failed', err);
  }
}

// ── Task 3: Scan expiry (90 days) ─────────────────────────────────────────────
// Deletes completed scans older than 90 days to keep the table lean.
// Also cleans up old completed/failed jobs (7 days) and nulls expired
// message_ids arrays in cleanup_actions to save storage.

async function runScanExpiry() {
  try {
    const scans = await query(
      `DELETE FROM scans
       WHERE status='complete' AND completed_at < NOW() - INTERVAL '90 days'
       RETURNING id`
    );
    if (scans.rowCount > 0) logger.info('Scan expiry: deleted old scans', { count: scans.rowCount });

    const jobs = await query(
      `DELETE FROM jobs
       WHERE status IN ('complete','failed') AND created_at < NOW() - INTERVAL '7 days'
       RETURNING id`
    );
    if (jobs.rowCount > 0) logger.info('Job queue: pruned old jobs', { count: jobs.rowCount });

    // Clear message_ids from expired undo windows (action record stays for history)
    const actions = await query(
      `UPDATE cleanup_actions SET message_ids='{}'
       WHERE expires_at < NOW() - INTERVAL '30 days'
         AND array_length(message_ids, 1) > 0`
    );
    if (actions.rowCount > 0) logger.info('Cleanup action IDs cleared', { count: actions.rowCount });

  } catch (err) {
    logger.error('Scan expiry failed', err);
  }
}

async function enqueueCleanup(userId, payload) {
  const result = await query(
    `INSERT INTO jobs (user_id, job_type, payload, status, max_attempts)
     VALUES ($1, 'CLEANUP', $2, 'queued', 1)
     RETURNING id`,
    [userId, JSON.stringify(payload)]
  );
  return result.rows[0].id;
}

async function enqueueDuePlaybookSchedules() {
  try {
    const due = await query(
      `SELECT s.playbook_id, p.user_id
       FROM playbook_schedules s
       JOIN playbooks p ON p.id = s.playbook_id
       WHERE s.is_active = TRUE
         AND p.is_active = TRUE
         AND s.frequency IN ('daily', 'weekly')
         AND s.next_run_at IS NOT NULL
         AND s.next_run_at <= NOW()
       ORDER BY s.next_run_at ASC
       LIMIT 20`
    );

    for (const row of due.rows) {
      await enqueuePlaybookRun(row.user_id, row.playbook_id, 'scheduled');
    }
  } catch (err) {
    logger.error('Failed enqueueing due playbook schedules', err);
  }
}

function stopWorker() {
  isRunning = false;
  logger.info('Background worker stopped');
}

module.exports = { startWorker, stopWorker, enqueueScan, enqueueCleanup };
