-- Batch 3: Admin Portal + Free-Tier Quota System Database Migration
-- Run this SQL in Supabase SQL Editor before deploying the code

-- 1. Add admin flag to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- 2. Create user_quota table (free-tier quota enforcement)
CREATE TABLE IF NOT EXISTS user_quota (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  -- Lifetime free allowance (500 emails total, shared across all-time use)
  lifetime_allowance INTEGER NOT NULL DEFAULT 500,
  lifetime_used INTEGER NOT NULL DEFAULT 0,
  -- Daily free quota (50 emails/day on login, resets at midnight UTC)
  daily_allowance INTEGER NOT NULL DEFAULT 50,
  daily_used INTEGER NOT NULL DEFAULT 0,
  daily_quota_granted_at TIMESTAMPTZ,   -- when today's 50 were granted (on login)
  daily_reset_at TIMESTAMPTZ,           -- next midnight UTC reset time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create index for performance
CREATE INDEX IF NOT EXISTS idx_user_quota_user_id ON user_quota(user_id);

-- 4. After running this migration, make yourself admin:
-- UPDATE users SET is_admin = TRUE WHERE email = 'your-email@gmail.com';

-- Verify the migration worked:
-- SELECT COUNT(*) FROM user_quota;  -- should return 0 (or higher if you had quota records)
-- SELECT COUNT(*) FROM users WHERE is_admin = TRUE;  -- should show admins
