// src/hooks/useCleanup.js
import { useState, useCallback } from 'react';
import { cleanupApi } from '../api/client';

const CLEANUP_POLL_MS = 2000;
const CLEANUP_MAX_WAIT_MS = 45 * 60 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function useCleanup() {
  const [executing, setExecuting] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [error, setError] = useState(null);

  const executeCleanup = useCallback(async ({
    scanId,
    category,
    messageIds,
    estimatedBytes,
    cleanupMode = 'ids',
    customQuery,
  }) => {
    setExecuting(true);
    setError(null);

    try {
      const response = await cleanupApi.execute({
        scanId,
        category,
        messageIds,
        estimatedBytes,
        cleanupMode,
        customQuery,
      });
      const data = response.data || {};

      // Async cleanup architecture: enqueue + poll worker status.
      if (data.jobId) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < CLEANUP_MAX_WAIT_MS) {
          await sleep(CLEANUP_POLL_MS);
          const jobRes = await cleanupApi.getJob(data.jobId);
          const job = jobRes.data || {};

          if (job.status === 'complete') {
            const finalResult = job.result || {
              actionId: job.actionId,
              successCount: 0,
              failedCount: 0,
              bytesFreed: estimatedBytes || 0,
            };
            setLastAction(finalResult);
            return finalResult;
          }

          if (job.status === 'failed') {
            const msg = job.error || 'Cleanup failed.';
            setError(msg);
            throw new Error(msg);
          }
        }

        throw new Error('Cleanup is still running. Please check Cleanup History in a few moments.');
      }

      // Backward compatibility for any older backend response.
      setLastAction(data);
      return data;
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Cleanup failed.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setExecuting(false);
    }
  }, []);

  const undoCleanup = useCallback(async (actionId) => {
    setUndoing(true);
    setError(null);

    try {
      const response = await cleanupApi.undo(actionId);
      setLastAction(null);
      return response.data;
    } catch (err) {
      const msg = err.response?.data?.error || 'Undo failed.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setUndoing(false);
    }
  }, []);

  return { executing, undoing, lastAction, error, executeCleanup, undoCleanup };
}
