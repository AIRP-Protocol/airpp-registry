import fs from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalJson, sha256 } from "./hash.js";

const schemaPath = path.resolve(process.cwd(), "schema/airpp-manifest-0.2.0.schema.json");
export const airppSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(airppSchema);

const AUDITABLE_REQUIRED = [
  "content_blocks",
  "sources",
  "generation_events",
  "review_events",
  "verification_records",
  "exports",
  "integrity"
];

export function validateManifest(manifest) {
  const schemaValid = validateSchema(manifest);
  const errors = [];
  const warnings = [];

  if (!schemaValid) {
    for (const err of validateSchema.errors || []) {
      errors.push({
        code: "SCHEMA_ERROR",
        path: err.instancePath || "/",
        message: err.message || "Schema validation error"
      });
    }
  }

  const level = manifest?.conformance_level;
  const actors = Array.isArray(manifest?.actors) ? manifest.actors : [];
  const accountable = actors.some(a => ["human", "organisation", "reviewer", "approver"].includes(a.actor_type));

  if (!accountable) {
    errors.push({
      code: "ACCOUNTABLE_ACTOR_REQUIRED",
      path: "/actors",
      message: "AIRPP manifests must include at least one accountable human, organisation, reviewer or approver actor."
    });
  }

  if (["auditable", "high_assurance"].includes(level)) {
    for (const field of AUDITABLE_REQUIRED) {
      if (!(field in manifest)) {
        errors.push({
          code: "AUDITABLE_FIELD_REQUIRED",
          path: `/${field}`,
          message: `${level} manifests must include ${field}.`
        });
      }
    }

    if (!manifest?.integrity?.manifest_hash) {
      errors.push({
        code: "MANIFEST_HASH_REQUIRED",
        path: "/integrity/manifest_hash",
        message: `${level} manifests must include integrity.manifest_hash.`
      });
    }

    if (Array.isArray(manifest?.generation_events)) {
      manifest.generation_events.forEach((event, index) => {
        if (!event.prompt_record) {
          warnings.push({
            code: "PROMPT_RECORD_RECOMMENDED",
            path: `/generation_events/${index}/prompt_record`,
            message: "Auditable generation events should include a prompt record using summary, redacted, hash_only or full_private capture mode where safe."
          });
        }
      });
    }
  }

  if (level === "high_assurance") {
    if (!manifest?.integrity?.event_chain) {
      warnings.push({
        code: "EVENT_CHAIN_RECOMMENDED",
        path: "/integrity/event_chain",
        message: "High-assurance manifests should include event-chain metadata."
      });
    }

    if (!manifest?.integrity?.package_hash) {
      warnings.push({
        code: "PACKAGE_HASH_RECOMMENDED",
        path: "/integrity/package_hash",
        message: "High-assurance manifests should include an export or package hash."
      });
    }

    const signedReview = Array.isArray(manifest?.review_events)
      ? manifest.review_events.some(r => r?.attestation?.signed === true)
      : false;

    if (!signedReview) {
      warnings.push({
        code: "SIGNED_REVIEW_ATTESTATION_RECOMMENDED",
        path: "/review_events",
        message: "High-assurance manifests should include at least one signed reviewer attestation."
      });
    }
  }

  const refWarnings = validateReferences(manifest);
  warnings.push(...refWarnings);

  const ok = errors.length === 0;
  const validatedLevel = ok ? deriveValidatedLevel(manifest, warnings) : null;

  return {
    ok,
    airpp_version: manifest?.airpp_version || null,
    claimed_conformance_level: level || null,
    validated_conformance_level: validatedLevel,
    errors,
    warnings,
    checks: {
      schema_valid: schemaValid,
      accountable_actor_present: accountable,
      required_fields_present: errors.filter(e => e.code.endsWith("_REQUIRED")).length === 0,
      internal_refs_resolve: !warnings.some(w => w.code === "UNRESOLVED_REFERENCE"),
      hash_calculable: true
    },
    computed: {
      canonical_manifest_hash: sha256(canonicalJson(withoutManifestHash(manifest)))
    }
  };
}

function validateReferences(manifest) {
  const warnings = [];
  const actorIds = new Set((manifest?.actors || []).map(a => a.actor_id));
  const sourceIds = new Set((manifest?.sources || []).map(s => s.source_id));
  const blockIds = new Set((manifest?.content_blocks || []).map(b => b.block_id));

  for (const [i, event] of (manifest?.generation_events || []).entries()) {
    if (event.actor_id && !actorIds.has(event.actor_id)) {
      warnings.push({
        code: "UNRESOLVED_REFERENCE",
        path: `/generation_events/${i}/actor_id`,
        message: `Generation event references unknown actor_id ${event.actor_id}.`
      });
    }
    for (const ref of event.input_refs || []) {
      if (!sourceIds.has(ref)) {
        warnings.push({
          code: "UNRESOLVED_REFERENCE",
          path: `/generation_events/${i}/input_refs`,
          message: `Generation event references unknown source_id ${ref}.`
        });
      }
    }
    for (const ref of event.target_block_ids || []) {
      if (!blockIds.has(ref)) {
        warnings.push({
          code: "UNRESOLVED_REFERENCE",
          path: `/generation_events/${i}/target_block_ids`,
          message: `Generation event references unknown block_id ${ref}.`
        });
      }
    }
  }

  for (const [i, event] of (manifest?.review_events || []).entries()) {
    if (event.actor_id && !actorIds.has(event.actor_id)) {
      warnings.push({
        code: "UNRESOLVED_REFERENCE",
        path: `/review_events/${i}/actor_id`,
        message: `Review event references unknown actor_id ${event.actor_id}.`
      });
    }
  }

  return warnings;
}

function deriveValidatedLevel(manifest, warnings) {
  if (manifest.conformance_level === "basic") return "basic";
  if (manifest.conformance_level === "auditable") return "auditable";
  if (manifest.conformance_level === "high_assurance") {
    return warnings.some(w => w.code.includes("RECOMMENDED")) ? "auditable_with_high_assurance_warnings" : "high_assurance";
  }
  return null;
}

function withoutManifestHash(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest || {}));
  if (copy.integrity?.manifest_hash?.value) {
    copy.integrity.manifest_hash.value = "";
  }
  return copy;
}
