-- 003_reports.sql
-- Downloadable validation reports, retention policy, manifest visibility

ALTER TABLE manifests ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE manifests ADD COLUMN IF NOT EXISTS redaction_mode TEXT NOT NULL DEFAULT 'none';
ALTER TABLE manifests ADD COLUMN IF NOT EXISTS retain_until TIMESTAMPTZ;

ALTER TABLE validation_runs ADD COLUMN IF NOT EXISTS report_pdf_available BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS validation_reports (
  id TEXT PRIMARY KEY,
  validation_run_id TEXT NOT NULL REFERENCES validation_runs(id),
  organisation_id TEXT,
  format TEXT NOT NULL DEFAULT 'json',
  report_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manifests_visibility ON manifests(visibility);
CREATE INDEX IF NOT EXISTS idx_validation_reports_run ON validation_reports(validation_run_id);
