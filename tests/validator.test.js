// tests/validator.test.js — AIRPP v0.3.0
import assert from "node:assert";
import { validateManifest } from "../src/lib/validator.js";
import { buildValidationReport } from "../src/lib/report.js";
import { generateApiKey, hashApiKey, signJwt, verifyJwt } from "../src/lib/auth.js";
import { Store } from "../src/lib/store.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗  ${name}: ${err.message}`);
    failed++;
  }
}

const basicManifest = {
  airpp_version: "0.2.0",
  manifest_id: "airpp-mf-test-001",
  conformance_level: "basic",
  created_at: "2026-04-25T09:00:00Z",
  report: { report_id: "rep-001", title: "Test Report", output_type: "general_document", language: "en-GB", created_at: "2026-04-25T09:00:00Z", current_version: "1.0.0" },
  ai_involvement: { level: "language_assist", human_final_responsibility: true, summary: "Test." },
  actors: [{ actor_id: "actor-001", actor_type: "human", display_name: "Test Author", role: "author_and_reviewer" }]
};

const auditableManifest = {
  ...basicManifest,
  manifest_id: "airpp-mf-test-002",
  conformance_level: "auditable",
  content_blocks: [{ block_id: "block-001", block_type: "section", title: "Test Section", ai_involvement: "draft_assist", verification_status: "human_checked" }],
  sources: [{ source_id: "src-001", source_type: "document", title: "Test Source", use_state: "relied_upon" }],
  generation_events: [{
    event_id: "gen-001", event_type: "ai_generation", occurred_at: "2026-04-25T09:00:00Z",
    actor_id: "actor-001", target_block_ids: ["block-001"], input_refs: ["src-001"],
    prompt_record: { capture_mode: "summary", prompt_summary: "Draft test content." },
    ai_involvement: "draft_assist"
  }],
  review_events: [{ review_event_id: "rev-001", event_type: "human_review", occurred_at: "2026-04-25T09:05:00Z", actor_id: "actor-001", review_type: "factual_check", review_outcome: "approved" }],
  verification_records: [{ verification_id: "ver-001", target_type: "content_block", target_id: "block-001", verification_status: "human_checked", checked_by: "actor-001", checked_at: "2026-04-25T09:06:00Z" }],
  exports: [{ export_id: "exp-001", export_type: "pdf", created_at: "2026-04-25T09:10:00Z", created_by: "actor-001", manifest_mode: "detached" }],
  integrity: { manifest_hash: { algorithm: "sha256", value: "REPLACE" }, signature_status: "unsigned_signing_ready" }
};

// ─── Validator tests ───────────────────────────────────────────────────────
console.log("\nValidator tests:");

test("valid basic manifest passes", () => {
  const r = validateManifest(basicManifest);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

test("valid auditable manifest passes", () => {
  const r = validateManifest(auditableManifest);
  assert.strictEqual(r.ok, true, JSON.stringify(r.errors));
});

test("missing airpp_version fails schema", () => {
  const { airpp_version, ...bad } = basicManifest;
  const r = validateManifest(bad);
  assert.strictEqual(r.ok, false);
});

test("manifest with no accountable actor fails", () => {
  const bad = { ...basicManifest, actors: [{ actor_id: "a1", actor_type: "ai_service", display_name: "AI", role: "generation_assistant" }] };
  const r = validateManifest(bad);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.code === "ACCOUNTABLE_ACTOR_REQUIRED"));
});

test("auditable manifest missing content_blocks fails", () => {
  const { content_blocks, ...bad } = auditableManifest;
  const r = validateManifest(bad);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some(e => e.code === "AUDITABLE_FIELD_REQUIRED"));
});

test("unresolved actor ref produces warning", () => {
  const bad = { ...basicManifest, conformance_level: "auditable", content_blocks: auditableManifest.content_blocks, sources: auditableManifest.sources, generation_events: [{ ...auditableManifest.generation_events[0], actor_id: "nonexistent" }], review_events: auditableManifest.review_events, verification_records: auditableManifest.verification_records, exports: auditableManifest.exports, integrity: auditableManifest.integrity };
  const r = validateManifest(bad);
  assert.ok(r.warnings.some(w => w.code === "UNRESOLVED_REFERENCE"));
});

test("computed hash is present and non-empty", () => {
  const r = validateManifest(basicManifest);
  assert.ok(r.computed.canonical_manifest_hash.length > 10);
});

test("null manifest body does not throw", () => {
  const r = validateManifest(null);
  assert.strictEqual(r.ok, false);
});

// ─── Report builder tests ──────────────────────────────────────────────────
console.log("\nReport builder tests:");

test("buildValidationReport returns expected shape", () => {
  const run = { id: "val-test-001", result_json: validateManifest(basicManifest) };
  const report = buildValidationReport({ validationRun: run, manifest: basicManifest });
  assert.ok(report.report_id);
  assert.ok(report.summary);
  assert.strictEqual(report.summary.ok, true);
  assert.ok(Array.isArray(report.notes));
});

// ─── Auth tests ────────────────────────────────────────────────────────────
console.log("\nAuth tests:");

test("generateApiKey produces airpp_ prefixed key", () => {
  const { raw, keyHash } = generateApiKey();
  assert.ok(raw.startsWith("airpp_"));
  assert.ok(keyHash.length === 64); // sha256 hex
});

test("hashApiKey is deterministic", () => {
  const { raw, keyHash } = generateApiKey();
  assert.strictEqual(hashApiKey(raw), keyHash);
});

test("signJwt and verifyJwt round-trip", () => {
  const payload = { user_id: "test-user", email: "test@example.com", role: "admin" };
  const token = signJwt(payload);
  const verified = verifyJwt(token);
  assert.strictEqual(verified.user_id, payload.user_id);
  assert.strictEqual(verified.email, payload.email);
});

test("verifyJwt returns null for invalid token", () => {
  const result = verifyJwt("not-a-valid-token");
  assert.strictEqual(result, null);
});

// ─── Store tests (in-memory) ───────────────────────────────────────────────
console.log("\nStore tests (in-memory):");

const store = new Store();

await testAsync("createOrganisation stores and retrieves", async () => {
  const org = await store.createOrganisation({ name: "Test Org" });
  assert.ok(org.id.startsWith("org_"));
  const found = await store.getOrganisation(org.id);
  assert.strictEqual(found.name, "Test Org");
});

await testAsync("createUser and getUserByEmail work", async () => {
  const user = await store.createUser({ email: "test@example.com", display_name: "Test User" });
  assert.ok(user.id.startsWith("user_"));
  const found = await store.getUserByEmail("test@example.com");
  assert.strictEqual(found.id, user.id);
});

await testAsync("createApiKey and verifyApiKey round-trip", async () => {
  const org = await store.createOrganisation({ name: "Key Org" });
  const { raw, keyHash } = generateApiKey();
  const key = await store.createApiKey({ organisation_id: org.id, key_hash: keyHash, name: "Test Key" });
  assert.ok(key.id.startsWith("key_"));
  const found = await store.verifyApiKey(raw);
  assert.strictEqual(found.id, key.id);
});

await testAsync("verifyApiKey returns null for unknown key", async () => {
  const { raw } = generateApiKey(); // never stored
  const result = await store.verifyApiKey(raw);
  assert.strictEqual(result, null);
});

await testAsync("revokeApiKey prevents subsequent verify", async () => {
  const org = await store.createOrganisation({ name: "Revoke Org" });
  const { raw, keyHash } = generateApiKey();
  const key = await store.createApiKey({ organisation_id: org.id, key_hash: keyHash, name: "Revoke Test" });
  await store.revokeApiKey(key.id, org.id);
  const result = await store.verifyApiKey(raw);
  assert.strictEqual(result, null);
});

await testAsync("createManifest and getManifest work", async () => {
  const result = validateManifest(basicManifest);
  const row = await store.createManifest({ manifest: basicManifest, manifestHash: result.computed.canonical_manifest_hash });
  assert.ok(row.id.startsWith("mfrow_"));
  const found = await store.getManifest(row.id);
  assert.strictEqual(found.manifest_id, basicManifest.manifest_id);
});

await testAsync("createValidationReport and getValidationReport work", async () => {
  const result = validateManifest(basicManifest);
  const run = await store.createValidationRun({ result });
  const report = buildValidationReport({ validationRun: { ...run, result_json: result }, manifest: basicManifest });
  const stored = await store.createValidationReport({ validation_run_id: run.id, format: "json", report_json: report });
  assert.ok(stored.id.startsWith("vrpt_"));
  const found = await store.getValidationReport(run.id);
  assert.strictEqual(found.validation_run_id, run.id);
});

await testAsync("createAttestation stores correctly", async () => {
  const result = validateManifest(basicManifest);
  const row = await store.createManifest({ manifest: basicManifest, manifestHash: result.computed.canonical_manifest_hash });
  const att = await store.createAttestation({
    manifest_row_id: row.id,
    attestation_type: "general",
    subject_type: "manifest",
    attestation_json: { statement: "I confirm this output." }
  });
  assert.ok(att.id.startsWith("att_"));
  assert.strictEqual(att.signature_status, "unsigned");
  const list = await store.listAttestations(row.id);
  assert.strictEqual(list.length, 1);
});

await testAsync("MCP session: create, append events, finalise", async () => {
  const { createBaseManifest, applyMcpEvent, finaliseManifest } = await import("../src/lib/mcpManifest.js");
  const manifest = createBaseManifest({ title: "MCP Test", outputType: "general_document" });
  const session = await store.createMcpSession({ sessionId: "mcp_test_123", manifestId: manifest.manifest_id, manifest });
  assert.strictEqual(session.session_id, "mcp_test_123");

  const updated = await store.appendMcpEvent("mcp_test_123", { event_type: "record_source", source_id: "src-001", source_type: "document", title: "Test Source", use_state: "selected_for_context", occurred_at: new Date().toISOString() }, applyMcpEvent);
  const current = typeof updated.current_manifest === "string" ? JSON.parse(updated.current_manifest) : updated.current_manifest;
  assert.strictEqual(current.sources.length, 1);

  const finalised = finaliseManifest(current);
  assert.ok(finalised.integrity.manifest_hash.value.length > 10);
});

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) process.exit(1);
