-- 004_attestations.sql
-- Signed attestations, signature metadata, audit trail per-event

ALTER TABLE attestations ADD COLUMN IF NOT EXISTS signer_actor_id TEXT;
ALTER TABLE attestations ADD COLUMN IF NOT EXISTS signature_algorithm TEXT;
ALTER TABLE attestations ADD COLUMN IF NOT EXISTS signature_value TEXT;
ALTER TABLE attestations ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS api_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_events_type ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC);
