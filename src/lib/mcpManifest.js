import { nanoid } from "nanoid";
import { sha256, canonicalJson } from "./hash.js";

export function createBaseManifest({ title, outputType = "general_document", actor }) {
  const now = new Date().toISOString();
  const actorRecord = actor || {
    actor_id: "actor-human-001",
    actor_type: "human",
    display_name: "Responsible User",
    role: "responsible_reviewer"
  };

  return {
    airpp_version: "0.2.0",
    manifest_id: `airpp-mf-${nanoid()}`,
    conformance_level: "auditable",
    created_at: now,
    report: {
      report_id: `report-${nanoid()}`,
      title: title || "AIRPP MCP Session Output",
      output_type: outputType,
      language: "en-GB",
      created_at: now,
      current_version: "0.1.0",
      intended_use: "implementation_testing"
    },
    ai_involvement: {
      level: "mixed_workflow",
      human_final_responsibility: true,
      summary: "AIRPP provenance was captured through MCP-style event recording."
    },
    actors: [
      actorRecord,
      {
        actor_id: "actor-airpp-mcp-server",
        actor_type: "software_system",
        display_name: "AIRPP MCP Server / Provenance Service",
        role: "provenance_capture"
      }
    ],
    content_blocks: [],
    sources: [],
    generation_events: [],
    review_events: [],
    verification_records: [],
    exports: [],
    integrity: {
      manifest_hash: {
        algorithm: "sha256",
        value: ""
      },
      signature_status: "unsigned_signing_ready"
    },
    extensions: {}
  };
}

export function applyMcpEvent(manifest, event) {
  const next = JSON.parse(JSON.stringify(manifest));

  if (event.event_type === "record_source") {
    next.sources.push({
      source_id: event.source_id || `src-${nanoid()}`,
      source_type: event.source_type || "document",
      title: event.title || "Untitled source",
      uri: event.uri || null,
      use_state: event.use_state || "selected_for_context",
      verification_state: event.verification_state || "not_checked"
    });
  }

  if (event.event_type === "record_generation") {
    const blockId = event.block_id || `block-${nanoid()}`;
    if (!next.content_blocks.some(b => b.block_id === blockId)) {
      next.content_blocks.push({
        block_id: blockId,
        block_type: event.block_type || "structured_content_block",
        title: event.block_title || "Generated content block",
        ai_involvement: event.ai_involvement || "draft_assist",
        verification_status: "not_checked"
      });
    }

    const aiActorId = event.actor_id || "actor-ai-service";
    if (!next.actors.some(a => a.actor_id === aiActorId)) {
      next.actors.push({
        actor_id: aiActorId,
        actor_type: "ai_service",
        display_name: event.model?.provider || "AI Service",
        role: "generation_assistant"
      });
    }

    next.generation_events.push({
      event_id: event.event_id || `gen-${nanoid()}`,
      event_type: "ai_generation",
      occurred_at: event.occurred_at || new Date().toISOString(),
      actor_id: aiActorId,
      target_block_ids: [blockId],
      model: event.model || { provider: "unknown_or_redacted", service: "unknown", model_id: "not_disclosed" },
      input_refs: event.input_refs || [],
      prompt_record: event.prompt_record || { capture_mode: "summary", prompt_summary: event.prompt_summary || "AI generation event recorded through AIRPP MCP binding." },
      output_role: event.output_role || "draft_text",
      ai_involvement: event.ai_involvement || "draft_assist"
    });
  }

  if (event.event_type === "record_review") {
    const reviewerId = event.actor_id || "actor-human-001";
    next.review_events.push({
      review_event_id: event.review_event_id || `rev-${nanoid()}`,
      event_type: "human_review",
      occurred_at: event.occurred_at || new Date().toISOString(),
      actor_id: reviewerId,
      review_type: event.review_type || "human_review",
      review_outcome: event.review_outcome || "reviewed_no_changes",
      notes: event.notes || "",
      attestation: {
        statement: event.attestation_statement || "Human review recorded.",
        signed: Boolean(event.signed)
      }
    });
  }

  if (event.event_type === "record_commit") {
    next.extensions["airpp-code"] = next.extensions["airpp-code"] || {
      repository: event.repository || null,
      branch: event.branch || null,
      pull_request: event.pull_request || null,
      commits: [],
      files_changed: [],
      tests: []
    };

    if (event.commit_sha) {
      next.extensions["airpp-code"].commits.push({
        commit_sha: event.commit_sha,
        message: event.message || "",
        ai_assisted: true
      });
      next.report.current_version = `commit:${event.commit_sha}`;
    }

    for (const file of event.files_changed || []) {
      next.extensions["airpp-code"].files_changed.push(
        typeof file === "string"
          ? { path: file, change_type: "modified", ai_contribution: "unknown" }
          : file
      );
    }
  }

  if (event.event_type === "record_export") {
    next.exports.push({
      export_id: event.export_id || `export-${nanoid()}`,
      export_type: event.export_type || "api_payload",
      created_at: event.created_at || new Date().toISOString(),
      created_by: event.created_by || "actor-human-001",
      includes_manifest: true,
      manifest_mode: event.manifest_mode || "api_transport",
      file_name: event.file_name || null,
      file_hash: event.file_hash || null
    });
  }

  return next;
}

export function finaliseManifest(manifest) {
  const next = JSON.parse(JSON.stringify(manifest));
  next.integrity = next.integrity || {};
  next.integrity.manifest_hash = next.integrity.manifest_hash || { algorithm: "sha256", value: "" };
  next.integrity.manifest_hash.value = "";
  next.integrity.manifest_hash.value = sha256(canonicalJson(next));
  next.integrity.hash_scope = "canonical_manifest_without_integrity_value";
  return next;
}
