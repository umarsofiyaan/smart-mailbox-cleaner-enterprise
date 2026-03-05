-- Credit-based quota + regional pricing migration
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_credits INTEGER DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_plan_used BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expiry TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emails_deleted_total INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_country VARCHAR(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS pricing_region TEXT DEFAULT 'full';
ALTER TABLE users ADD COLUMN IF NOT EXISTS region_detected_at TIMESTAMPTZ;

UPDATE users
SET delete_credits = COALESCE(delete_credits, 1000),
    free_plan_used = COALESCE(free_plan_used, FALSE),
    plan_type = COALESCE(plan_type, 'free'),
    emails_deleted_total = COALESCE(emails_deleted_total, 0),
    pricing_region = COALESCE(pricing_region, 'full');

ALTER TABLE subscription_status ADD COLUMN IF NOT EXISTS pending_plan_type VARCHAR(50);
