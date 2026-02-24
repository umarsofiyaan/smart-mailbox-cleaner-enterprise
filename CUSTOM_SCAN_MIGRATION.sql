-- CUSTOM_SCAN_MIGRATION.sql
-- Run this in Supabase SQL Editor before deploying the backend changes.
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING).

-- Add scan_type column to distinguish 'quick' vs 'custom' scans
ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS scan_type VARCHAR(20) DEFAULT 'quick';

-- Store the exact Gmail query used (for display + debugging)
ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS custom_query TEXT;

-- Store the raw params object the user set in the UI (for re-running)
ALTER TABLE scans
  ADD COLUMN IF NOT EXISTS custom_params JSONB;

-- Backfill existing rows
UPDATE scans SET scan_type = 'quick' WHERE scan_type IS NULL;

-- Index for filtering by scan type
CREATE INDEX IF NOT EXISTS idx_scans_scan_type ON scans(scan_type);

-- Confirm
SELECT 'Custom scan migration complete ✓' AS status;
