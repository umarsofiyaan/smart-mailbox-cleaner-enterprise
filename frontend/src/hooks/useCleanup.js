// src/hooks/useCleanup.js
import { useState, useCallback } from 'react';
import { cleanupApi } from '../api/client';

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
    expectedMessageCount,
    mailboxId,
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
        expectedMessageCount,
        mailboxId,
      });
      setLastAction(response.data);
      return response.data;
    } catch (err) {
      const statusCode = err?.response?.status;
      const msg = err.response?.data?.error || err.message || 'Cleanup failed.';
      if (statusCode === 409) {
        const data = err?.response?.data || {};
        const friendly = data.error || 'A cleanup is already in progress. Please check Cleanup History.';
        setError(friendly);
        const conflictError = new Error(friendly);
        conflictError.code = data.code || 'CLEANUP_ALREADY_RUNNING';
        conflictError.data = data;
        throw conflictError;
      }
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
