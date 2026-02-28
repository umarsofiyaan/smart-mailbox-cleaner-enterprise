-- ============================================================
-- Round 3 Migration
-- Run this in DBeaver BEFORE deploying Round 3 code.
-- Safe to run multiple times (all statements are idempotent).
-- ============================================================

-- 1. Admin audit log table
--    Records every admin action: role changes, plan changes, deletions, quota edits.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  admin_email    VARCHAR(255),
  target_user_id UUID,
  target_email   VARCHAR(255),
  action         VARCHAR(100) NOT NULL,
  details        JSONB DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin_id       ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_target_user_id ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at     ON admin_audit_log(created_at DESC);

-- 2. Soft-delete columns on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at  TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by  UUID        DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- 3. Email notification flags on user_quota
--    Prevents duplicate quota warning / exhausted emails per user.
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS quota_warning_sent   BOOLEAN DEFAULT FALSE;
ALTER TABLE user_quota ADD COLUMN IF NOT EXISTS quota_exhausted_sent BOOLEAN DEFAULT FALSE;

-- Verify:
-- SELECT COUNT(*) FROM admin_audit_log;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'deleted_at';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'user_quota' AND column_name = 'quota_warning_sent';
