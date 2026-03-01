// src/hooks/useScan.js
import { useState, useRef, useCallback, useEffect } from 'react';
import { scanApi } from '../api/client';

const POLL_INTERVAL_MS = 3000;

export function useScan() {
  const [scanId, setScanId] = useState(null);
  const [scan,   setScan]   = useState(null);
  const [status, setStatus] = useState('idle'); // idle | starting | running | complete | failed
  const [error,  setError]  = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const pollScan = useCallback(async (id) => {
    try {
      const response = await scanApi.getScan(id);
      const data = response.data;
      setScan(data);

      if (data.status === 'complete') {
        setStatus('complete');
        stopPolling();
      } else if (data.status === 'failed') {
        setStatus('failed');
        setError(data.error || 'Scan failed. Please try again.');
        stopPolling();
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, []);

  // ── Quick scan ────────────────────────────────────────────────────────────

  const startScan = useCallback(async (scanDepth = '12months') => {
    setStatus('starting');
    setError(null);
    setScan(null);
    stopPolling();

    try {
      const response = await scanApi.startScan(scanDepth);
      const { scanId: newScanId } = response.data;
      setScanId(newScanId);
      setStatus('running');

      pollRef.current = setInterval(() => pollScan(newScanId), POLL_INTERVAL_MS);
      await pollScan(newScanId);

    } catch (err) {
      const statusCode = err?.response?.status;
      const msg = err.response?.data?.error || 'Failed to start scan.';
      if (statusCode === 409) {
        setError('A scan is already in progress. Please wait for it to finish.');
        setStatus('running');
        const existingId = err?.response?.data?.scanId;
        if (existingId) {
          setScanId(existingId);
          stopPolling();
          pollRef.current = setInterval(() => pollScan(existingId), POLL_INTERVAL_MS);
          await pollScan(existingId);
        }
        return;
      }
      setError(msg);
      setStatus('failed');
      throw err;
    }
  }, [pollScan]);

  // ── Custom scan ───────────────────────────────────────────────────────────

  const startCustomScan = useCallback(async (params) => {
    setStatus('starting');
    setError(null);
    setScan(null);
    stopPolling();

    try {
      const response = await scanApi.startCustomScan(params);
      const { scanId: newScanId, query } = response.data;
      setScanId(newScanId);
      setStatus('running');

      pollRef.current = setInterval(() => pollScan(newScanId), POLL_INTERVAL_MS);
      await pollScan(newScanId);

    } catch (err) {
      const statusCode = err?.response?.status;
      const msg = err.response?.data?.error || 'Failed to start custom scan.';
      if (statusCode === 409) {
        setError('A scan is already in progress. Please wait for it to finish.');
        setStatus('running');
        const existingId = err?.response?.data?.scanId;
        if (existingId) {
          setScanId(existingId);
          stopPolling();
          pollRef.current = setInterval(() => pollScan(existingId), POLL_INTERVAL_MS);
          await pollScan(existingId);
        }
        return;
      }
      setError(msg);
      setStatus('failed');
      throw err;
    }
  }, [pollScan]);

  // ── Load latest ──────────────────────────────────────────────────────────

  const loadLatestScan = useCallback(async () => {
    try {
      const latestRes = await scanApi.getLatestScan();
      const { scanId: latestId } = latestRes.data;
      const scanRes = await scanApi.getScan(latestId);
      setScan(scanRes.data);
      setScanId(latestId);
      setStatus('complete');
    } catch {
      // No previous scan - stays idle
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setScan(null);
    setScanId(null);
    setStatus('idle');
    setError(null);
  }, []);

  return { scan, scanId, status, error, startScan, startCustomScan, loadLatestScan, reset };
}
