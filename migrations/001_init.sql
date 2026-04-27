CREATE TABLE IF NOT EXISTS organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS airpp_versions (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  schema_uri TEXT NOT NULL,
  schema_hash TEXT,
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS extensions (
  id TEXT PRIMARY KEY,
  extension_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  current_version TEXT,
  schema_uri TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS implementations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  name TEXT NOT NULL,
  implementation_type TEXT NOT NULL,
  website TEXT,
  supported_airpp_versions TEXT[] NOT NULL DEFAULT '{}',
  supported_conformance_levels TEXT[] NOT NULL DEFAULT '{}',
  supported_manifest_modes TEXT[] NOT NULL DEFAULT '{}',
  supported_extensions TEXT[] NOT NULL DEFAULT '{}',
  registry_status TEXT NOT NULL DEFAULT 'self_declared',
  public_listing BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manifests (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  manifest_id TEXT NOT NULL,
  airpp_version TEXT NOT NULL,
  conformance_level TEXT NOT NULL,
  report_title TEXT,
  report_output_type TEXT,
  manifest_json JSONB NOT NULL,
  manifest_hash TEXT,
  storage_mode TEXT NOT NULL DEFAULT 'stored_manifest_only',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  manifest_row_id TEXT REFERENCES manifests(id),
  airpp_version TEXT NOT NULL,
  conformance_level_claimed TEXT,
  conformance_level_validated TEXT,
  ok BOOLEAN NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]',
  warnings JSONB NOT NULL DEFAULT '[]',
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  manifest_row_id TEXT REFERENCES manifests(id),
  attestation_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_digest TEXT,
  attestation_json JSONB NOT NULL,
  signature_status TEXT NOT NULL DEFAULT 'unsigned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_sessions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  session_id TEXT NOT NULL UNIQUE,
  manifest_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  event_log JSONB NOT NULL DEFAULT '[]',
  current_manifest JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  event_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO airpp_versions (id, version, status, schema_uri, released_at)
VALUES ('airpp-version-0.2.0', '0.2.0', 'frozen_public_draft', '/api/v1/schema/0.2.0', now())
ON CONFLICT (version) DO NOTHING;

INSERT INTO extensions (id, extension_key, name, status, current_version, schema_uri)
VALUES
  ('ext-code', 'airpp-code', 'AIRPP Code Provenance Extension', 'draft', '0.1.0', NULL),
  ('ext-attestation', 'airpp-attestation', 'AIRPP Attestation Extension', 'draft', '0.1.0', NULL),
  ('ext-reg-tax', 'airpp-reg-tax', 'AIRPP Regulated Tax Extension', 'draft', '0.1.0', NULL),
  ('ext-legal', 'airpp-legal', 'AIRPP Legal Extension', 'draft', '0.1.0', NULL),
  ('ext-prov', 'airpp-prov-mapping', 'AIRPP W3C PROV Mapping Extension', 'draft', '0.1.0', NULL),
  ('ext-c2pa', 'airpp-c2pa-bridge', 'AIRPP C2PA Bridge Extension', 'draft', '0.1.0', NULL)
ON CONFLICT (extension_key) DO NOTHING;
