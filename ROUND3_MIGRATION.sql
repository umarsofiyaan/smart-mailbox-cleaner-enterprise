-- ROUND3_MIGRATION.sql
-- Batch 3: Email system, pagination, admin features, soft-delete, scan expiry
-- Created for Smart Mailbox Cleaner

-- ============================================================================
-- 1. ADD SOFT-DELETE COLUMNS TO users TABLE
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create index for soft-delete queries (for listing non-deleted users)
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);

-- ============================================================================
-- 2. CREATE ADMIN AUDIT LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  -- action values: 'set_admin', 'remove_admin', 'upgrade_plan', 'downgrade_plan', 
  --                'set_quota', 'delete_user', 'restore_user', 'reset_scan_history'
  before_values JSONB,
  after_values JSONB,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user_id ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON admin_audit_log(created_at DESC);

-- ============================================================================
-- 3. ADD QUOTA FLAGS TO user_quota TABLE (if not already present)
-- ============================================================================
-- These flags track warning/limit states for Pro users
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS last_warning_email_sent TIMESTAMP NULL;
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS is_at_limit BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 4. ADD EMAIL TRACKING COLUMNS TO users TABLE
-- ============================================================================
-- Track which emails have been sent to the user
ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_quota_warning_sent TIMESTAMP NULL;

-- ============================================================================
-- 5. ENSURE subscriptions TABLE EXISTS (for Razorpay integration)
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  razorpay_subscription_id VARCHAR(255) UNIQUE,
  plan VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free', 'pro', 'lifetime'
  status VARCHAR(50) NOT NULL DEFAULT 'inactive', -- 'active', 'paused', 'canceled', 'inactive'
  current_period_start DATE,
  current_period_end DATE,
  next_billing_date DATE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_razorpay_id ON subscriptions(razorpay_subscription_id);

-- ============================================================================
-- 6. ENSURE cleanup_actions TABLE EXISTS (for undo functionality)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cleanup_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES scans(id) ON DELETE SET NULL,
  category VARCHAR(100) NOT NULL,
  message_count INT NOT NULL,
  bytes_freed BIGINT NOT NULL,
  message_ids TEXT[], -- Array of Gmail message IDs
  action_type VARCHAR(50) DEFAULT 'delete', -- 'delete', 'archive'
  status VARCHAR(50) DEFAULT 'completed', -- 'pending', 'completed', 'failed', 'undone'
  undo_deadline TIMESTAMP, -- 30 days from creation
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cleanup_actions_user_id ON cleanup_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_scan_id ON cleanup_actions(scan_id);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_status ON cleanup_actions(status);
CREATE INDEX IF NOT EXISTS idx_cleanup_actions_created_at ON cleanup_actions(created_at DESC);

-- ============================================================================
-- 7. ENSURE scans TABLE HAS expiry_date COLUMN
-- ============================================================================
-- For automatic cleanup of old scans (90+ days)
ALTER TABLE scans ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;

-- Set expiry for existing scans (90 days from created_at)
UPDATE scans SET expires_at = created_at + INTERVAL '90 days' WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scans_expires_at ON scans(expires_at);

-- ============================================================================
-- 8. ENSURE message_cache TABLE HAS expiry_date COLUMN
-- ============================================================================
-- For automatic cleanup of cached message IDs (7+ days)
ALTER TABLE message_cache ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP NULL;

-- Set expiry for existing message_cache entries (7 days from created_at)
UPDATE message_cache SET expires_at = created_at + INTERVAL '7 days' WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_cache_expires_at ON message_cache(expires_at);

-- ============================================================================
-- 9. CREATE email_logs TABLE (optional, for debugging)
-- ============================================================================
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email_type VARCHAR(50) NOT NULL, -- 'welcome', 'cleanup_receipt', 'quota_warning', 'pro_upgrade'
  recipient_email VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary of changes:
-- ✓ Added soft-delete columns (deleted_at, deleted_by) to users table
-- ✓ Created admin_audit_log table with comprehensive indexing
-- ✓ Added quota warning tracking columns
-- ✓ Added email tracking flags
-- ✓ Ensured subscriptions table exists
-- ✓ Ensured cleanup_actions table exists for undo functionality
-- ✓ Added expiry tracking to scans and message_cache for auto-cleanup
-- ✓ Created email_logs table for audit trail

-- ============================================================================
-- VERIFICATION QUERIES (run these to verify migration worked)
-- ============================================================================
-- SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('deleted_at', 'deleted_by');
-- SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='admin_audit_log');
-- SELECT column_name FROM information_schema.columns WHERE table_name='user_quota' AND column_name IN ('last_warning_email_sent', 'is_at_limit');
