-- Marketing consent (POPIA)
-- Adds opt-in marketing consent tracking to customers.
-- Consent defaults to FALSE (explicit opt-in required, per POPIA).

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marketing_consent_version TEXT;

COMMENT ON COLUMN customers.marketing_consent IS 'Whether the customer has opted in to marketing communications (POPIA).';
COMMENT ON COLUMN customers.marketing_consent_at IS 'Timestamp of the most recent consent change.';
COMMENT ON COLUMN customers.marketing_consent_version IS 'Version identifier of the consent wording the customer agreed to.';
