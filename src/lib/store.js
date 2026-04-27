// src/lib/store.js
// Dual-mode data store: Postgres (production) or in-memory (demo/dev)
import pg from "pg";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { hashApiKey } from "./auth.js";

const { Pool } = pg;

export class Store {
  constructor() {
    this.pool = config.databaseUrl ? new Pool({ connectionString: config.databaseUrl }) : null;
    this.memory = {
      organisations: [],
      users: [],
      apiKeys: [],
      invitations: [],
      implementations: [],
      manifests: [],
      validationRuns: [],
      validationReports: [],
      mcpSessions: [],
      extensions: seedExtensions(),
      attestations: [],
      auditEvents: [],
    };
  }

  async isUsingDatabase() {
    return Boolean(this.pool);
  }

  // ─── Audit log ─────────────────────────────────────────────────────────

  async logAuditEvent({ event_type, target_type = null, target_id = null, event_json = {}, ip_address = null, user_agent = null, actor_user_id = null, api_key_id = null, organisation_id = null }) {
    const id = `audit_${nanoid()}`;
    const record = { id, organisation_id, actor_user_id, api_key_id, event_type, target_type, target_id, event_json, ip_address, user_agent, created_at: new Date().toISOString() };

    if (!this.pool) {
      this.memory.auditEvents.push(record);
      return record;
    }
    const { rows } = await this.pool.query(
      `INSERT INTO audit_events (id, organisation_id, actor_user_id, api_key_id, event_type, target_type, target_id, event_json, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, organisation_id, actor_user_id, api_key_id, event_type, target_type, target_id, JSON.stringify(event_json), ip_address, user_agent]
    );
    return rows[0];
  }

  async listAuditEvents({ limit = 200, organisation_id = null } = {}) {
    if (!this.pool) {
      let events = this.memory.auditEvents.slice().reverse();
      if (organisation_id) events = events.filter(e => e.organisation_id === organisation_id);
      return events.slice(0, limit);
    }
    const base = "SELECT * FROM audit_events";
    if (organisation_id) {
      const { rows } = await this.pool.query(`${base} WHERE organisation_id = $1 ORDER BY created_at DESC LIMIT $2`, [organisation_id, limit]);
      return rows;
    }
    const { rows } = await this.pool.query(`${base} ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows;
  }

  // ─── Organisations ─────────────────────────────────────────────────────

  async createOrganisation({ name, website = null }) {
    const id = `org_${nanoid()}`;
    const record = { id, name, website, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.organisations.push(record); return record; }
    const { rows } = await this.pool.query(
      "INSERT INTO organisations (id, name, website) VALUES ($1,$2,$3) RETURNING *",
      [id, name, website]
    );
    return rows[0];
  }

  async getOrganisation(id) {
    if (!this.pool) return this.memory.organisations.find(o => o.id === id) || null;
    const { rows } = await this.pool.query("SELECT * FROM organisations WHERE id = $1", [id]);
    return rows[0] || null;
  }

  // ─── Users ─────────────────────────────────────────────────────────────

  async createUser({ email, display_name = null, password_hash = null, organisation_id = null, role = "member", github_id = null, github_username = null, email_verify_token = null }) {
    const id = `user_${nanoid()}`;
    const record = { id, organisation_id, email, display_name, role, password_hash, email_verified: false, email_verify_token, reset_token: null, reset_token_expires: null, github_id, github_username, last_login: null, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.users.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, organisation_id, email, display_name, role, password_hash, email_verified, email_verify_token, github_id, github_username)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [id, organisation_id, email, display_name, role, password_hash, false, email_verify_token, github_id, github_username]
    );
    return rows[0];
  }

  async getUserByEmail(email) {
    if (!this.pool) return this.memory.users.find(u => u.email === email) || null;
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return rows[0] || null;
  }

  async getUserById(id) {
    if (!this.pool) return this.memory.users.find(u => u.id === id) || null;
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] || null;
  }

  async getUserByGithubId(github_id) {
    if (!this.pool) return this.memory.users.find(u => u.github_id === String(github_id)) || null;
    const { rows } = await this.pool.query("SELECT * FROM users WHERE github_id = $1", [String(github_id)]);
    return rows[0] || null;
  }

  async getUserByEmailVerifyToken(token) {
    if (!this.pool) return this.memory.users.find(u => u.email_verify_token === token) || null;
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email_verify_token = $1", [token]);
    return rows[0] || null;
  }

  async getUserByResetToken(token) {
    if (!this.pool) {
      return this.memory.users.find(u => u.reset_token === token && new Date(u.reset_token_expires) > new Date()) || null;
    }
    const { rows } = await this.pool.query(
      "SELECT * FROM users WHERE reset_token = $1 AND reset_token_expires > now()", [token]
    );
    return rows[0] || null;
  }

  async updateUser(id, fields) {
    if (!this.pool) {
      const user = this.memory.users.find(u => u.id === id);
      if (!user) return null;
      Object.assign(user, fields);
      return user;
    }
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const { rows } = await this.pool.query(
      `UPDATE users SET ${setClauses} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return rows[0] || null;
  }

  // ─── API Keys ──────────────────────────────────────────────────────────

  async createApiKey({ organisation_id, user_id = null, key_hash, name, scopes = [], description = null }) {
    const id = `key_${nanoid()}`;
    const record = { id, organisation_id, user_id, key_hash, name, scopes, description, last_used_at: null, revoked_at: null, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.apiKeys.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO api_keys (id, organisation_id, user_id, key_hash, name, scopes, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, organisation_id, user_id, key_hash, name, scopes, description]
    );
    return rows[0];
  }

  async verifyApiKey(rawKey) {
    const keyHash = hashApiKey(rawKey);
    if (!this.pool) {
      const key = this.memory.apiKeys.find(k => k.key_hash === keyHash && !k.revoked_at);
      if (key) { key.last_used_at = new Date().toISOString(); }
      return key || null;
    }
    const { rows } = await this.pool.query(
      "SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL", [keyHash]
    );
    if (rows[0]) {
      await this.pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [rows[0].id]);
    }
    return rows[0] || null;
  }

  async listApiKeys(organisation_id) {
    if (!this.pool) return this.memory.apiKeys.filter(k => k.organisation_id === organisation_id && !k.revoked_at);
    const { rows } = await this.pool.query(
      "SELECT id, organisation_id, user_id, name, scopes, description, last_used_at, created_at FROM api_keys WHERE organisation_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
      [organisation_id]
    );
    return rows;
  }

  async revokeApiKey(id, organisation_id) {
    if (!this.pool) {
      const key = this.memory.apiKeys.find(k => k.id === id && k.organisation_id === organisation_id);
      if (key) key.revoked_at = new Date().toISOString();
      return key || null;
    }
    const { rows } = await this.pool.query(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND organisation_id = $2 RETURNING *",
      [id, organisation_id]
    );
    return rows[0] || null;
  }

  // ─── Invitations ───────────────────────────────────────────────────────

  async createInvitation({ organisation_id, invited_email, invited_by, role = "member", token, expires_at }) {
    const id = `inv_${nanoid()}`;
    const record = { id, organisation_id, invited_email, invited_by, role, token, expires_at, accepted_at: null, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.invitations.push(record); return record; }
    const { rows } = await this.pool.query(
      "INSERT INTO invitations (id, organisation_id, invited_email, invited_by, role, token, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [id, organisation_id, invited_email, invited_by, role, token, expires_at]
    );
    return rows[0];
  }

  async getInvitation(token) {
    if (!this.pool) return this.memory.invitations.find(i => i.token === token) || null;
    const { rows } = await this.pool.query("SELECT * FROM invitations WHERE token = $1", [token]);
    return rows[0] || null;
  }

  async acceptInvitation(token) {
    if (!this.pool) {
      const inv = this.memory.invitations.find(i => i.token === token);
      if (inv) inv.accepted_at = new Date().toISOString();
      return inv || null;
    }
    const { rows } = await this.pool.query(
      "UPDATE invitations SET accepted_at = now() WHERE token = $1 RETURNING *", [token]
    );
    return rows[0] || null;
  }

  // ─── Extensions ────────────────────────────────────────────────────────

  async listExtensions() {
    if (!this.pool) return this.memory.extensions;
    const { rows } = await this.pool.query("SELECT * FROM extensions ORDER BY extension_key");
    return rows;
  }

  // ─── Implementations ───────────────────────────────────────────────────

  async createImplementation(data) {
    const id = data.id || `impl_${nanoid()}`;
    const record = {
      id,
      organisation_id: data.organisation_id || null,
      name: data.name,
      implementation_type: data.implementation_type,
      website: data.website || null,
      supported_airpp_versions: data.supported_airpp_versions || ["0.2.0"],
      supported_conformance_levels: data.supported_conformance_levels || [],
      supported_manifest_modes: data.supported_manifest_modes || [],
      supported_extensions: data.supported_extensions || [],
      registry_status: data.registry_status || "self_declared",
      public_listing: Boolean(data.public_listing),
      created_at: new Date().toISOString()
    };
    if (!this.pool) { this.memory.implementations.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO implementations (id, organisation_id, name, implementation_type, website, supported_airpp_versions, supported_conformance_levels, supported_manifest_modes, supported_extensions, registry_status, public_listing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [record.id, record.organisation_id, record.name, record.implementation_type, record.website, record.supported_airpp_versions, record.supported_conformance_levels, record.supported_manifest_modes, record.supported_extensions, record.registry_status, record.public_listing]
    );
    return rows[0];
  }

  async listPublicImplementations() {
    if (!this.pool) return this.memory.implementations.filter(i => i.public_listing);
    const { rows } = await this.pool.query("SELECT * FROM implementations WHERE public_listing = true ORDER BY created_at DESC");
    return rows;
  }

  // ─── Manifests ─────────────────────────────────────────────────────────

  async createManifest({ manifest, manifestHash, organisationId = null, visibility = "private" }) {
    const id = `mfrow_${nanoid()}`;
    const record = {
      id,
      organisation_id: organisationId,
      manifest_id: manifest.manifest_id,
      airpp_version: manifest.airpp_version,
      conformance_level: manifest.conformance_level,
      report_title: manifest.report?.title || null,
      report_output_type: manifest.report?.output_type || null,
      manifest_json: manifest,
      manifest_hash: manifestHash,
      storage_mode: "stored_manifest_only",
      visibility,
      created_at: new Date().toISOString()
    };
    if (!this.pool) { this.memory.manifests.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO manifests (id, organisation_id, manifest_id, airpp_version, conformance_level, report_title, report_output_type, manifest_json, manifest_hash, storage_mode, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [record.id, record.organisation_id, record.manifest_id, record.airpp_version, record.conformance_level, record.report_title, record.report_output_type, record.manifest_json, record.manifest_hash, record.storage_mode, record.visibility]
    );
    return rows[0];
  }

  async listManifests({ organisation_id = null, visibility = null } = {}) {
    if (!this.pool) {
      let items = this.memory.manifests.slice().reverse();
      if (organisation_id) items = items.filter(m => m.organisation_id === organisation_id);
      if (visibility) items = items.filter(m => m.visibility === visibility);
      return items.slice(0, 100);
    }
    const conditions = [];
    const values = [];
    if (organisation_id) { conditions.push(`organisation_id = $${values.length + 1}`); values.push(organisation_id); }
    if (visibility) { conditions.push(`visibility = $${values.length + 1}`); values.push(visibility); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.pool.query(
      `SELECT id, manifest_id, airpp_version, conformance_level, report_title, report_output_type, manifest_hash, visibility, created_at FROM manifests ${where} ORDER BY created_at DESC LIMIT 100`,
      values
    );
    return rows;
  }

  async getManifest(id) {
    if (!this.pool) return this.memory.manifests.find(m => m.id === id) || null;
    const { rows } = await this.pool.query("SELECT * FROM manifests WHERE id = $1", [id]);
    return rows[0] || null;
  }

  // ─── Validation runs ───────────────────────────────────────────────────

  async createValidationRun({ manifestRowId = null, result, organisationId = null }) {
    const id = `val_${nanoid()}`;
    const record = {
      id,
      organisation_id: organisationId,
      manifest_row_id: manifestRowId,
      airpp_version: result.airpp_version || "unknown",
      conformance_level_claimed: result.claimed_conformance_level,
      conformance_level_validated: result.validated_conformance_level,
      ok: result.ok,
      errors: result.errors || [],
      warnings: result.warnings || [],
      result_json: result,
      created_at: new Date().toISOString()
    };
    if (!this.pool) { this.memory.validationRuns.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO validation_runs (id, organisation_id, manifest_row_id, airpp_version, conformance_level_claimed, conformance_level_validated, ok, errors, warnings, result_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [record.id, record.organisation_id, record.manifest_row_id, record.airpp_version, record.conformance_level_claimed, record.conformance_level_validated, record.ok, JSON.stringify(record.errors), JSON.stringify(record.warnings), JSON.stringify(record.result_json)]
    );
    return rows[0];
  }

  async listValidationRuns({ organisation_id = null } = {}) {
    if (!this.pool) {
      let runs = this.memory.validationRuns.slice().reverse();
      if (organisation_id) runs = runs.filter(r => r.organisation_id === organisation_id);
      return runs.slice(0, 100);
    }
    const where = organisation_id ? "WHERE organisation_id = $1" : "";
    const vals = organisation_id ? [organisation_id] : [];
    const { rows } = await this.pool.query(
      `SELECT id, airpp_version, conformance_level_claimed, conformance_level_validated, ok, errors, warnings, created_at FROM validation_runs ${where} ORDER BY created_at DESC LIMIT 100`,
      vals
    );
    return rows;
  }

  // ─── Validation reports ────────────────────────────────────────────────

  async createValidationReport({ validation_run_id, organisation_id = null, format = "json", report_json }) {
    const id = `vrpt_${nanoid()}`;
    const record = { id, validation_run_id, organisation_id, format, report_json, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.validationReports.push(record); return record; }
    const { rows } = await this.pool.query(
      "INSERT INTO validation_reports (id, validation_run_id, organisation_id, format, report_json) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, validation_run_id, organisation_id, format, JSON.stringify(report_json)]
    );
    return rows[0];
  }

  async getValidationReport(validation_run_id) {
    if (!this.pool) return this.memory.validationReports.find(r => r.validation_run_id === validation_run_id) || null;
    const { rows } = await this.pool.query("SELECT * FROM validation_reports WHERE validation_run_id = $1", [validation_run_id]);
    return rows[0] || null;
  }

  // ─── MCP sessions ─────────────────────────────────────────────────────

  async createMcpSession({ sessionId, manifestId, manifest }) {
    const record = { id: `mcps_${nanoid()}`, session_id: sessionId, manifest_id: manifestId, status: "open", event_log: [], current_manifest: manifest, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (!this.pool) { this.memory.mcpSessions.push(record); return record; }
    const { rows } = await this.pool.query(
      "INSERT INTO mcp_sessions (id, session_id, manifest_id, status, event_log, current_manifest) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [record.id, record.session_id, record.manifest_id, record.status, JSON.stringify([]), JSON.stringify(manifest)]
    );
    return rows[0];
  }

  async getMcpSession(sessionId) {
    if (!this.pool) return this.memory.mcpSessions.find(s => s.session_id === sessionId) || null;
    const { rows } = await this.pool.query("SELECT * FROM mcp_sessions WHERE session_id = $1", [sessionId]);
    return rows[0] || null;
  }

  async appendMcpEvent(sessionId, event, manifestMutator) {
    const session = await this.getMcpSession(sessionId);
    if (!session) return null;
    const eventLog = Array.isArray(session.event_log) ? session.event_log : JSON.parse(session.event_log || "[]");
    const manifest = typeof session.current_manifest === "string" ? JSON.parse(session.current_manifest) : session.current_manifest;
    eventLog.push(event);
    const nextManifest = manifestMutator ? manifestMutator(manifest, event) : manifest;
    if (!this.pool) {
      session.event_log = eventLog; session.current_manifest = nextManifest; session.updated_at = new Date().toISOString();
      return session;
    }
    const { rows } = await this.pool.query(
      "UPDATE mcp_sessions SET event_log = $2, current_manifest = $3, updated_at = now() WHERE session_id = $1 RETURNING *",
      [sessionId, JSON.stringify(eventLog), JSON.stringify(nextManifest)]
    );
    return rows[0];
  }

  async finaliseMcpSession(sessionId, manifest) {
    if (!this.pool) {
      const session = this.memory.mcpSessions.find(s => s.session_id === sessionId);
      if (!session) return null;
      session.status = "finalised"; session.current_manifest = manifest; session.updated_at = new Date().toISOString();
      return session;
    }
    const { rows } = await this.pool.query(
      "UPDATE mcp_sessions SET status = 'finalised', current_manifest = $2, updated_at = now() WHERE session_id = $1 RETURNING *",
      [sessionId, JSON.stringify(manifest)]
    );
    return rows[0] || null;
  }

  // ─── Attestations ──────────────────────────────────────────────────────

  async createAttestation({ organisation_id = null, manifest_row_id, attestation_type, subject_type, subject_digest = null, attestation_json, signer_actor_id = null, signature_algorithm = null, signature_value = null }) {
    const id = `att_${nanoid()}`;
    const signed_at = signature_value ? new Date().toISOString() : null;
    const sig_status = signature_value ? "signed" : "unsigned";
    const record = { id, organisation_id, manifest_row_id, attestation_type, subject_type, subject_digest, attestation_json, signer_actor_id, signature_algorithm, signature_value, signed_at, signature_status: sig_status, created_at: new Date().toISOString() };
    if (!this.pool) { this.memory.attestations.push(record); return record; }
    const { rows } = await this.pool.query(
      `INSERT INTO attestations (id, organisation_id, manifest_row_id, attestation_type, subject_type, subject_digest, attestation_json, signature_status, signer_actor_id, signature_algorithm, signature_value, signed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, organisation_id, manifest_row_id, attestation_type, subject_type, subject_digest, JSON.stringify(attestation_json), sig_status, signer_actor_id, signature_algorithm, signature_value, signed_at]
    );
    return rows[0];
  }

  async listAttestations(manifest_row_id) {
    if (!this.pool) return this.memory.attestations.filter(a => a.manifest_row_id === manifest_row_id);
    const { rows } = await this.pool.query("SELECT * FROM attestations WHERE manifest_row_id = $1 ORDER BY created_at DESC", [manifest_row_id]);
    return rows;
  }
}

function seedExtensions() {
  const now = new Date().toISOString();
  return [
    { id: "ext-code", extension_key: "airpp-code", name: "AIRPP Code Provenance Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now },
    { id: "ext-attestation", extension_key: "airpp-attestation", name: "AIRPP Attestation Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now },
    { id: "ext-reg-tax", extension_key: "airpp-reg-tax", name: "AIRPP Regulated Tax Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now },
    { id: "ext-legal", extension_key: "airpp-legal", name: "AIRPP Legal Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now },
    { id: "ext-prov", extension_key: "airpp-prov-mapping", name: "AIRPP W3C PROV Mapping Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now },
    { id: "ext-c2pa", extension_key: "airpp-c2pa-bridge", name: "AIRPP C2PA Bridge Extension", status: "draft", current_version: "0.1.0", schema_uri: null, created_at: now }
  ];
}
