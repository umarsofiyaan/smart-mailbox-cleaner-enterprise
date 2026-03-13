// src/config/migrate.js
// Run with: node src/config/migrate.js
require('dotenv').config();
const { pool } = require('./database');

const MIGRATION_SQL = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  display_name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth tokens (refresh token AES-256 encrypted)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS connected_mailboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  google_account_id VARCHAR(255) NOT NULL,
  google_email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  scopes TEXT[],
  is_primary BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, google_account_id)
);

-- Scan sessions
CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(50) DEFAULT 'pending',
  scan_depth VARCHAR(20) DEFAULT '12months',
  total_messages_scanned BIGINT DEFAULT 0,
  storage_used_bytes BIGINT DEFAULT 0,
  storage_quota_bytes BIGINT DEFAULT 0,
  storage_growth_daily_bytes BIGINT DEFAULT 0,
  estimated_days_until_full BIGINT,
  categories_json JSONB DEFAULT '[]',
  confidence_summary JSONB DEFAULT '{}',
  estimated_bytes_freeable BIGINT DEFAULT 0,
  next_page_token TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

-- Cleanup actions (audit trail + undo support)
CREATE TABLE IF NOT EXISTS cleanup_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES scans(id),
  category VARCHAR(100),
  message_ids TEXT[] NOT NULL,
  action_type VARCHAR(50) DEFAULT 'trash',
  status VARCHAR(50) DEFAULT 'pending',
  bytes_freed BIGINT DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  undone_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days'
);

ALTER TABLE cleanup_actions ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE cleanup_actions ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES connected_mailboxes(id) ON DELETE SET NULL;

-- Subscription status
CREATE TABLE IF NOT EXISTS subscription_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  plan VARCHAR(50) DEFAULT 'free',
  status VARCHAR(50) DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscription_status ADD COLUMN IF NOT EXISTS pending_plan_type VARCHAR(50);

-- Background job queue
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_type VARCHAR(100) NOT NULL,
  payload JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'queued',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh token rotation table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  is_revoked BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fix integer overflow on existing databases (safe to run multiple times)
ALTER TABLE scans ALTER COLUMN total_messages_scanned TYPE BIGINT;
ALTER TABLE scans ALTER COLUMN estimated_days_until_full TYPE BIGINT;

-- Track original labels per message before trashing (for correct undo restore)
CREATE TABLE IF NOT EXISTS message_original_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID REFERENCES cleanup_actions(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  label_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Track whether a user has seen the onboarding guide
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Admin flag on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Credit-based deletion model
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_credits INTEGER DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_plan_used BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emails_deleted_total INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS storage_recovered_mb INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_clean_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_clean_frequency TEXT DEFAULT 'weekly';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_clean_last_run_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_clean_max_inbox_mb INTEGER DEFAULT 5120;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_country VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_region TEXT DEFAULT 'full';
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_detected_at TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES connected_mailboxes(id) ON DELETE SET NULL;

UPDATE users
SET delete_credits = COALESCE(delete_credits, 1000),
    free_plan_used = COALESCE(free_plan_used, FALSE),
    plan_type = COALESCE(plan_type, 'free'),
    emails_deleted_total = COALESCE(emails_deleted_total, 0),
    storage_recovered_mb = COALESCE(storage_recovered_mb, 0),
    auto_clean_enabled = COALESCE(auto_clean_enabled, FALSE),
    auto_clean_frequency = COALESCE(auto_clean_frequency, 'weekly'),
    auto_clean_max_inbox_mb = COALESCE(auto_clean_max_inbox_mb, 5120),
    pricing_region = COALESCE(pricing_region, 'full'),
    updated_at = NOW();

-- Email deletion quota tracking (free tier enforcement)
CREATE TABLE IF NOT EXISTS user_quota (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  -- Lifetime free allowance (1,000 emails total, shared across all-time use)
  lifetime_allowance INTEGER NOT NULL DEFAULT 1000,
  -- Daily quota disabled for the new free model (legacy field kept for compatibility)
  daily_allowance INTEGER NOT NULL DEFAULT 0,
  daily_used INTEGER NOT NULL DEFAULT 0,
   daily_quota_granted_at TIMESTAMPTZ,
  daily_reset_at TIMESTAMPTZ,           -- next midnight UTC reset time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Keep existing DBs aligned with current free-tier defaults.
ALTER TABLE user_quota ALTER COLUMN lifetime_allowance SET DEFAULT 1000;
ALTER TABLE user_quota ALTER COLUMN daily_allowance SET DEFAULT 0;
UPDATE user_quota
SET lifetime_allowance = GREATEST(lifetime_allowance, 1000),
    daily_allowance = 0,
    daily_used = 0,
    updated_at = NOW()
WHERE lifetime_allowance < 1000 OR daily_allowance != 0 OR daily_used != 0;

CREATE INDEX IF NOT EXISTS idx_user_quota_user_id ON user_quota(user_id);


-- Newsletter + sender controls + inbox health analytics
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_domain VARCHAR(255) NOT NULL,
  sender_email VARCHAR(255),
  email_count INTEGER DEFAULT 0,
  unsubscribe_link TEXT,
  status VARCHAR(30) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blocked_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sender_email VARCHAR(255) NOT NULL,
  action VARCHAR(30) DEFAULT 'auto_delete',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  total_emails BIGINT DEFAULT 0,
  unread_emails BIGINT DEFAULT 0,
  newsletter_emails BIGINT DEFAULT 0,
  promotional_emails BIGINT DEFAULT 0,
  storage_used_mb INTEGER DEFAULT 0,
  health_score INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scans ADD COLUMN IF NOT EXISTS top_senders_json JSONB DEFAULT '[]';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS newsletter_senders_json JSONB DEFAULT '[]';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS sender_frequency_json JSONB DEFAULT '{}';
ALTER TABLE scans ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 0;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS estimated_storage_mb INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_newsletter_subscription_sender
  ON newsletter_subscriptions(user_id, sender_domain);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_blocked_sender_email
  ON blocked_senders(user_id, sender_email);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_user_id ON newsletter_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_status ON newsletter_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_blocked_senders_user_id ON blocked_senders(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_health_user_id ON inbox_health(user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_message_labels_action_id ON message_original_labels(action_id);
CREATE INDEX IF NOT EXISTS idx_message_labels_message_id ON message_original_labels(message_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_mailboxes_user_id ON connected_mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_mailboxes_primary ON connected_mailboxes(user_id, is_primary);
CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_mailbox_id ON scans(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_user_id ON cleanup_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_expires_at ON cleanup_actions(expires_at);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_status ON cleanup_actions(status);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_mailbox_id ON cleanup_actions(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at ON jobs(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_user_id ON subscription_status(user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers
DO $$ BEGIN
  CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_oauth_tokens_updated_at BEFORE UPDATE ON oauth_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_connected_mailboxes_updated_at BEFORE UPDATE ON connected_mailboxes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_subscription_updated_at BEFORE UPDATE ON subscription_status FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Batch 3 (Change 4.0) Migrations
-- Admin audit log + soft-delete + email notification flags
-- ============================================================

-- 1. Admin audit log table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_email    VARCHAR(255),
  target_user_id UUID,
  target_email   VARCHAR(255),
  action         VARCHAR(100) NOT NULL,
  detail         JSONB DEFAULT '{}',
  ip_address     VARCHAR(45),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS detail JSONB DEFAULT '{}';
ALTER TABLE admin_audit_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'admin_audit_log' AND column_name = 'details'
  ) THEN
    EXECUTE 'UPDATE admin_audit_log SET detail = COALESCE(detail, details, ''{}''::jsonb)';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id       ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user_id ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at     ON admin_audit_log(created_at DESC);

-- 2. Soft-delete columns on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by  UUID        DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. Email notification flags on user_quota
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS quota_warning_sent   BOOLEAN DEFAULT FALSE;
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS quota_exhausted_sent BOOLEAN DEFAULT FALSE;

-- 4. Mailbox link history (admin visibility for add/remove/primary changes)
CREATE TABLE IF NOT EXISTS mailbox_link_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  mailbox_id UUID,
  google_account_id VARCHAR(255),
  google_email VARCHAR(255),
  event_type VARCHAR(50) NOT NULL, -- connected | reconnected | set_primary | disconnected | auto_primary_switch
  actor_user_id UUID,
  actor_email VARCHAR(255),
  actor_role VARCHAR(20) DEFAULT 'user', -- user | admin | system
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_events_user_id ON mailbox_link_events(user_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_events_created_at ON mailbox_link_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mailbox_events_email ON mailbox_link_events(google_email);

-- One-time extension login exchange codes
CREATE TABLE IF NOT EXISTS extension_exchange_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash VARCHAR(64) UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extension_exchange_code_hash ON extension_exchange_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_extension_exchange_user_id ON extension_exchange_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_extension_exchange_expires_at ON extension_exchange_codes(expires_at);

-- ============================================================
-- Automation (Playbooks + Schedules + Runs)
-- ============================================================

CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  query TEXT NOT NULL,
  safety_rules JSONB NOT NULL DEFAULT '{"exclude_starred":true,"exclude_important":false,"exclude_replied_threads":false}',
  action_mode VARCHAR(20) NOT NULL DEFAULT 'trash',
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playbook_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID REFERENCES playbooks(id) ON DELETE CASCADE UNIQUE,
  frequency VARCHAR(20) NOT NULL DEFAULT 'none',
  day_of_week INTEGER,
  run_at_utc TIME NOT NULL DEFAULT '03:00:00',
  timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playbook_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playbook_id UUID REFERENCES playbooks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  trigger_source VARCHAR(20) NOT NULL DEFAULT 'manual',
  playbook_name_snapshot VARCHAR(120),
  query_snapshot TEXT,
  safety_rules_snapshot JSONB,
  playbook_version_snapshot INTEGER,
  playbook_updated_at_snapshot TIMESTAMPTZ,
  matched_count BIGINT NOT NULL DEFAULT 0,
  cleaned_count BIGINT NOT NULL DEFAULT 0,
  estimated_bytes BIGINT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_user_active ON playbooks(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_playbook_schedules_due ON playbook_schedules(next_run_at, is_active);
CREATE INDEX IF NOT EXISTS idx_playbook_runs_user_created ON playbook_runs(user_id, created_at DESC);

-- Backward-compatible ALTERs for already-provisioned DBs.
ALTER TABLE playbooks ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE playbook_schedules ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) NOT NULL DEFAULT 'UTC';
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS trigger_source VARCHAR(20) NOT NULL DEFAULT 'manual';
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS playbook_name_snapshot VARCHAR(120);
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS query_snapshot TEXT;
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS safety_rules_snapshot JSONB;
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS playbook_version_snapshot INTEGER;
ALTER TABLE playbook_runs ADD COLUMN IF NOT EXISTS playbook_updated_at_snapshot TIMESTAMPTZ;

DO $$ BEGIN
  CREATE TRIGGER update_playbooks_updated_at
  BEFORE UPDATE ON playbooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_playbook_schedules_updated_at
  BEFORE UPDATE ON playbook_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`;

async function migrate() {
  console.log('Running database migrations...');
  try {
    await pool.query(MIGRATION_SQL);
    console.log('✅ Migrations complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    try {
      await pool.end();
    } catch (poolErr) {
      console.error('Error closing pool:', poolErr);
    }
  }
}

migrate();
