// src/hooks/useScan.js
import { useState, useRef, useCallback } from 'react';
import { scanApi } from '../api/client';

const POLL_INTERVAL_MS = 3000;

export function useScan() {
  const [scanId, setScanId] = useState(null);
  const [scan, setScan] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | starting | running | complete | failed
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

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

      // Start polling
      pollRef.current = setInterval(() => pollScan(newScanId), POLL_INTERVAL_MS);
      // Immediate first poll
      await pollScan(newScanId);

    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to start scan.';
      setError(msg);
      setStatus('failed');
    }
  }, [pollScan]);

  const loadLatestScan = useCallback(async () => {
    try {
      const latestRes = await scanApi.getLatestScan();
      const { scanId: latestId } = latestRes.data;
      const scanRes = await scanApi.getScan(latestId);
      setScan(scanRes.data);
      setScanId(latestId);
      setStatus('complete');
    } catch {
      // No previous scan
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setScan(null);
    setScanId(null);
    setStatus('idle');
    setError(null);
  }, []);

  return { scan, scanId, status, error, startScan, loadLatestScan, reset };
}
