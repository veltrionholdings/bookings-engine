-- Platform Portal tables
-- Run this migration to add tables needed by the platform admin portal

-- Audit log for tracking all write operations
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id TEXT NOT NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Platform configuration (single row)
CREATE TABLE IF NOT EXISTS platform_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  maintenance_mode BOOLEAN DEFAULT false,
  default_timezone TEXT DEFAULT 'Africa/Johannesburg',
  max_tenants INTEGER DEFAULT 100,
  email_enabled BOOLEAN DEFAULT true,
  global_rate_limit INTEGER DEFAULT 1000,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Insert default config
INSERT INTO platform_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- API Keys for tenant programmatic access
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  rate_limit INTEGER DEFAULT 1000,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

-- Email logs for tracking sent notifications
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'bounced', 'failed')),
  error TEXT,
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_tenant ON email_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed default email templates
INSERT INTO email_templates (name, subject, body_html, variables) VALUES
  ('booking_confirmation', 'Booking Confirmed — {{business_name}}', '<h2>Your booking is confirmed</h2><p>Hi {{customer_name}},</p><p>Your appointment for <strong>{{service_name}}</strong> on {{date}} at {{time}} has been confirmed.</p>', ARRAY['customer_name', 'service_name', 'date', 'time', 'business_name']),
  ('booking_cancellation', 'Booking Cancelled — {{business_name}}', '<h2>Booking Cancelled</h2><p>Hi {{customer_name}},</p><p>Your appointment for <strong>{{service_name}}</strong> on {{date}} at {{time}} has been cancelled.</p><p>Reason: {{reason}}</p>', ARRAY['customer_name', 'service_name', 'date', 'time', 'reason', 'business_name']),
  ('booking_reschedule', 'Booking Rescheduled — {{business_name}}', '<h2>Booking Rescheduled</h2><p>Hi {{customer_name}},</p><p>Your appointment has been moved to {{new_date}} at {{new_time}}.</p>', ARRAY['customer_name', 'service_name', 'new_date', 'new_time', 'business_name']),
  ('booking_no_show', 'Missed Appointment — {{business_name}}', '<h2>Missed Appointment</h2><p>Hi {{customer_name}},</p><p>We noticed you missed your appointment on {{date}} at {{time}}. Please contact us to reschedule.</p>', ARRAY['customer_name', 'service_name', 'date', 'time', 'business_name'])
ON CONFLICT (name) DO NOTHING;

-- Scheduled jobs registry
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  schedule TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  last_run TIMESTAMPTZ,
  last_status TEXT CHECK (last_status IN ('success', 'failure')),
  next_run TIMESTAMPTZ
);

-- Seed default jobs
INSERT INTO scheduled_jobs (name, description, schedule, enabled) VALUES
  ('Auto-cancel stale bookings', 'Cancel pending bookings older than 24 hours', 'rate(1 hour)', true),
  ('Send appointment reminders', 'Send reminder emails 24 hours before appointment', 'rate(1 hour)', true),
  ('Cleanup expired tokens', 'Remove expired refresh tokens from the database', 'rate(1 day)', true),
  ('Usage metrics aggregation', 'Aggregate daily usage stats per tenant', 'rate(1 day)', true)
ON CONFLICT DO NOTHING;

-- Announcements from platform to tenants
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_tenant_ids JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add status column to tenants if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'status') THEN
    ALTER TABLE tenants ADD COLUMN status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'slug') THEN
    ALTER TABLE tenants ADD COLUMN slug TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'settings') THEN
    ALTER TABLE tenants ADD COLUMN settings JSONB DEFAULT '{}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'updated_at') THEN
    ALTER TABLE tenants ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;
