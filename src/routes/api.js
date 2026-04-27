// src/routes/api.js — v0.3.0
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { airppSchema, validateManifest } from "../lib/validator.js";
import { sha256, canonicalJson } from "../lib/hash.js";
import { requireApiKey, requireJwtOrApiKey, auditContext } from "../lib/auth.js";
import { createBaseManifest, applyMcpEvent, finaliseManifest } from "../lib/mcpManifest.js";
import { buildValidationReport } from "../lib/report.js";
import { validateLimiter } from "../lib/rateLimit.js";
import { config } from "../lib/config.js";

export function createApiRouter(store) {
  const router = express.Router();

  // Inject store onto req so auth middleware can use it
  router.use((req, _res, next) => { req.store = store; next(); });

  // ─── Public endpoints ─────────────────────────────────────────────────

  router.get("/health", async (_req, res) => {
    res.json({
      ok: true,
      service: "airpp-registry",
      version: "0.3.0",
      status: "frozen_public_draft",
      storage: (await store.isUsingDatabase()) ? "postgres" : "memory"
    });
  });

  router.get("/spec", (_req, res) => {
    const specPath = path.resolve(process.cwd(), "spec/airpp-v0.2.0-public-draft.md");
    res.type("text/markdown").send(fs.readFileSync(specPath, "utf8"));
  });

  router.get("/schema/0.2.0", (_req, res) => res.json(airppSchema));

  router.get("/examples/basic", (_req, res) => {
    const p = path.resolve(process.cwd(), "examples/basic-report.airpp.json");
    res.json(JSON.parse(fs.readFileSync(p, "utf8")));
  });

  router.get("/examples/auditable", (_req, res) => {
    const p = path.resolve(process.cwd(), "examples/auditable-report.airpp.json");
    res.json(JSON.parse(fs.readFileSync(p, "utf8")));
  });

  router.get("/extensions", async (_req, res) => {
    res.json({ ok: true, extensions: await store.listExtensions() });
  });

  router.get("/implementations/public", async (_req, res) => {
    res.json({ ok: true, implementations: await store.listPublicImplementations() });
  });

  // ─── Validate ─────────────────────────────────────────────────────────

  router.post("/validate", validateLimiter, async (req, res) => {
    const body = req.body;
    const bodySize = JSON.stringify(body || {}).length;
    if (bodySize > config.maxManifestBytes) {
      return res.status(413).json({ ok: false, error: "payload_too_large", message: `Manifest must be under ${config.maxManifestBytes} bytes.` });
    }

    const result = validateManifest(body);
    const run = await store.createValidationRun({
      result,
      organisationId: req.organisationId || null
    });

    // Auto-generate downloadable report
    const report = buildValidationReport({ validationRun: { ...run, result_json: result }, manifest: body });
    await store.createValidationReport({ validation_run_id: run.id, organisation_id: run.organisation_id, format: "json", report_json: report });

    await store.logAuditEvent({
      event_type: "manifest_validated",
      target_type: "validation_run",
      target_id: run.id,
      event_json: { ok: result.ok, conformance_level: result.claimed_conformance_level },
      ...auditContext(req)
    });

    res.status(result.ok ? 200 : 400).json({ ...result, validation_id: run.id });
  });

  // ─── Validation report download ────────────────────────────────────────

  router.get("/validation-runs/:id/report", async (req, res) => {
    const report = await store.getValidationReport(req.params.id);
    if (!report) return res.status(404).json({ ok: false, error: "report_not_found" });
    const reportJson = typeof report.report_json === "string" ? JSON.parse(report.report_json) : report.report_json;
    res.json({ ok: true, report: reportJson });
  });

  // ─── Implementations (write — authenticated) ───────────────────────────

  router.post("/implementations", requireJwtOrApiKey, async (req, res) => {
    const body = req.body || {};
    if (!body.name || !body.implementation_type) {
      return res.status(400).json({ ok: false, error: "missing_required_fields", required: ["name", "implementation_type"] });
    }
    const record = await store.createImplementation({ ...body, organisation_id: req.organisationId || req.user?.organisation_id || null });
    await store.logAuditEvent({ event_type: "implementation_registered", target_type: "implementation", target_id: record.id, event_json: { name: body.name }, ...auditContext(req) });
    res.status(201).json({ ok: true, implementation: record });
  });

  // ─── Manifests ────────────────────────────────────────────────────────

  router.post("/manifests", requireJwtOrApiKey, async (req, res) => {
    const manifest = req.body;
    const bodySize = JSON.stringify(manifest || {}).length;
    if (bodySize > config.maxManifestBytes) return res.status(413).json({ ok: false, error: "payload_too_large" });

    const result = validateManifest(manifest);
    const manifestHash = result.computed.canonical_manifest_hash;
    const visibility = req.body._visibility === "public" ? "public" : "private";
    const manifestRow = await store.createManifest({ manifest, manifestHash, organisationId: req.organisationId || req.user?.organisation_id || null, visibility });
    const validationRun = await store.createValidationRun({ manifestRowId: manifestRow.id, result, organisationId: manifestRow.organisation_id });

    const report = buildValidationReport({ validationRun: { ...validationRun, result_json: result }, manifest });
    await store.createValidationReport({ validation_run_id: validationRun.id, organisation_id: validationRun.organisation_id, format: "json", report_json: report });

    await store.logAuditEvent({ event_type: "manifest_stored", target_type: "manifest", target_id: manifestRow.id, event_json: { ok: result.ok, visibility }, ...auditContext(req) });

    res.status(result.ok ? 201 : 400).json({ ok: result.ok, manifest_row: manifestRow, validation_id: validationRun.id, validation: result });
  });

  router.get("/manifests", requireJwtOrApiKey, async (req, res) => {
    const organisation_id = req.user?.organisation_id || req.organisationId || null;
    const manifests = await store.listManifests({ organisation_id });
    res.json({ ok: true, manifests });
  });

  router.get("/manifests/:id", requireJwtOrApiKey, async (req, res) => {
    const manifest = await store.getManifest(req.params.id);
    if (!manifest) return res.status(404).json({ ok: false, error: "manifest_not_found" });
    // Enforce private access
    const orgId = req.user?.organisation_id || req.organisationId;
    if (manifest.visibility === "private" && manifest.organisation_id !== orgId) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    res.json({ ok: true, manifest });
  });

  // ─── Validation runs ──────────────────────────────────────────────────

  router.get("/validation-runs", requireJwtOrApiKey, async (_req, res) => {
    res.json({ ok: true, validation_runs: await store.listValidationRuns() });
  });

  // ─── Attestations ─────────────────────────────────────────────────────

  router.post("/manifests/:id/attestations", requireJwtOrApiKey, async (req, res) => {
    const manifest = await store.getManifest(req.params.id);
    if (!manifest) return res.status(404).json({ ok: false, error: "manifest_not_found" });

    const { attestation_type = "general", subject_type = "manifest", attestation_statement, signer_actor_id = null, signature_algorithm = null, signature_value = null } = req.body || {};
    const attestation = await store.createAttestation({
      organisation_id: manifest.organisation_id,
      manifest_row_id: manifest.id,
      attestation_type,
      subject_type,
      subject_digest: manifest.manifest_hash,
      attestation_json: { statement: attestation_statement, actor_id: signer_actor_id, created_at: new Date().toISOString() },
      signer_actor_id,
      signature_algorithm,
      signature_value
    });

    await store.logAuditEvent({ event_type: "attestation_created", target_type: "attestation", target_id: attestation.id, event_json: { manifest_id: manifest.id, signature_status: attestation.signature_status }, ...auditContext(req) });

    res.status(201).json({ ok: true, attestation });
  });

  router.get("/manifests/:id/attestations", requireJwtOrApiKey, async (req, res) => {
    const manifest = await store.getManifest(req.params.id);
    if (!manifest) return res.status(404).json({ ok: false, error: "manifest_not_found" });
    const attestations = await store.listAttestations(manifest.id);
    res.json({ ok: true, attestations });
  });

  // ─── Audit log ────────────────────────────────────────────────────────

  router.get("/audit-log", requireJwtOrApiKey, async (req, res) => {
    const organisation_id = req.user?.organisation_id || req.organisationId || null;
    const events = await store.listAuditEvents({ organisation_id, limit: 200 });
    res.json({ ok: true, audit_events: events });
  });

  // ─── MCP provenance sandbox ───────────────────────────────────────────

  router.post("/mcp/start-manifest", requireJwtOrApiKey, async (req, res) => {
    const manifest = createBaseManifest({ title: req.body?.title, outputType: req.body?.output_type, actor: req.body?.actor });
    const sessionId = req.body?.session_id || `mcp_${nanoid()}`;
    const session = await store.createMcpSession({ sessionId, manifestId: manifest.manifest_id, manifest });
    await store.logAuditEvent({ event_type: "mcp_session_started", target_type: "mcp_session", target_id: session.id, ...auditContext(req) });
    res.status(201).json({ ok: true, session_id: session.session_id, manifest });
  });

  router.post("/mcp/record-source", requireJwtOrApiKey, async (req, res) => {
    await appendMcp(store, req, res, { event_type: "record_source", ...req.body });
  });

  router.post("/mcp/record-generation", requireJwtOrApiKey, async (req, res) => {
    await appendMcp(store, req, res, { event_type: "record_generation", ...req.body });
  });

  router.post("/mcp/record-review", requireJwtOrApiKey, async (req, res) => {
    await appendMcp(store, req, res, { event_type: "record_review", ...req.body });
  });

  router.post("/mcp/record-commit", requireJwtOrApiKey, async (req, res) => {
    await appendMcp(store, req, res, { event_type: "record_commit", ...req.body });
  });

  router.post("/mcp/record-export", requireJwtOrApiKey, async (req, res) => {
    await appendMcp(store, req, res, { event_type: "record_export", ...req.body });
  });

  router.post("/mcp/finalise-manifest", requireJwtOrApiKey, async (req, res) => {
    const session = await store.getMcpSession(req.body?.session_id);
    if (!session) return res.status(404).json({ ok: false, error: "mcp_session_not_found" });

    const manifest = typeof session.current_manifest === "string" ? JSON.parse(session.current_manifest) : session.current_manifest;
    const finalised = finaliseManifest(manifest);
    const result = validateManifest(finalised);
    await store.finaliseMcpSession(session.session_id, finalised);

    const manifestRow = await store.createManifest({ manifest: finalised, manifestHash: sha256(canonicalJson(finalised)) });
    const validationRun = await store.createValidationRun({ manifestRowId: manifestRow.id, result });
    const report = buildValidationReport({ validationRun: { ...validationRun, result_json: result }, manifest: finalised });
    await store.createValidationReport({ validation_run_id: validationRun.id, format: "json", report_json: report });

    await store.logAuditEvent({ event_type: "mcp_session_finalised", target_type: "mcp_session", target_id: session.id, event_json: { ok: result.ok }, ...auditContext(req) });

    res.status(result.ok ? 200 : 400).json({ ok: result.ok, session_id: session.session_id, manifest: finalised, validation_id: validationRun.id, validation: result });
  });

  router.get("/mcp/sessions/:session_id", requireJwtOrApiKey, async (req, res) => {
    const session = await store.getMcpSession(req.params.session_id);
    if (!session) return res.status(404).json({ ok: false, error: "mcp_session_not_found" });
    res.json({ ok: true, session });
  });

  return router;
}

async function appendMcp(store, req, res, event) {
  const sessionId = req.body?.session_id;
  if (!sessionId) return res.status(400).json({ ok: false, error: "session_id_required" });
  event.occurred_at = event.occurred_at || new Date().toISOString();
  const session = await store.appendMcpEvent(sessionId, event, applyMcpEvent);
  if (!session) return res.status(404).json({ ok: false, error: "mcp_session_not_found" });
  res.json({ ok: true, session_id: sessionId, event, manifest: typeof session.current_manifest === "string" ? JSON.parse(session.current_manifest) : session.current_manifest });
}
