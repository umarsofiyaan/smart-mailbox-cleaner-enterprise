// src/jobs/worker.js
// Simple DB-backed job queue worker. No Redis required.
// Polls for queued jobs every 10 seconds.

const { query } = require('../config/database');
const { runScan } = require('../services/scanEngine');
const { getOAuthTokens } = require('../services/tokenService');
const logger = require('../utils/logger');

const POLL_INTERVAL_MS = 10000; // 10 seconds
const MAX_CONCURRENT_JOBS = 3;
let activeJobs = 0;
let isRunning = false;

/**
 * Start the background worker
 */
function startWorker() {
  if (isRunning) return;
  isRunning = true;
  logger.info('Background job worker started');
  poll();
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
    // Atomically claim a queued job
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

      // Get tokens for user
      const tokens = await getOAuthTokens(user_id);

      // Update scan to link with this job
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

/**
 * Enqueue a scan job
 */
async function enqueueScan(userId, scanId, scanDepth = '12months') {
  await query(
    `INSERT INTO jobs (user_id, job_type, payload, status)
     VALUES ($1, 'SCAN', $2, 'queued')`,
    [userId, JSON.stringify({ scanId, scanDepth })]
  );
}

/**
 * Stop the worker gracefully
 */
function stopWorker() {
  isRunning = false;
  logger.info('Background worker stopped');
}

module.exports = { startWorker, stopWorker, enqueueScan };
