-- Newsletter detection + sender controls + inbox health
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
