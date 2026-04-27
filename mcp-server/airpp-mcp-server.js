#!/usr/bin/env node
// mcp-server/airpp-mcp-server.js
// Formal MCP server wrapping the AIRPP Registry HTTP API
// Implements the Model Context Protocol (2025-03-26) over stdio
// Usage: node mcp-server/airpp-mcp-server.js
// Env: AIRPP_REGISTRY_URL, AIRPP_API_KEY

import readline from "node:readline";
import crypto from "node:crypto";

const REGISTRY_URL = process.env.AIRPP_REGISTRY_URL || "http://localhost:8787";
const API_KEY = process.env.AIRPP_API_KEY || "";

const TOOLS = [
  {
    name: "airpp_start_manifest",
    description: "Start a new AIRPP provenance manifest session for the current report or output. Returns a session_id used in subsequent provenance capture calls.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the report or output being captured." },
        output_type: { type: "string", description: "Output type (e.g. general_document, code_change, policy_briefing, tax_report)." },
        actor: {
          type: "object",
          description: "Optional. The responsible human actor. Defaults to a placeholder.",
          properties: {
            actor_id: { type: "string" },
            actor_type: { type: "string" },
            display_name: { type: "string" },
            role: { type: "string" }
          }
        }
      },
      required: ["title"]
    }
  },
  {
    name: "airpp_record_source",
    description: "Record a source document or data asset that was used as context for an AI generation step.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "The session_id returned by airpp_start_manifest." },
        source_id: { type: "string", description: "Unique identifier for this source." },
        source_type: { type: "string", description: "Source type: document, repository, api, database, url, conversation." },
        title: { type: "string", description: "Human-readable title of the source." },
        uri: { type: "string", description: "URI or reference for the source (may be internal or redacted)." },
        use_state: { type: "string", description: "How it was used: selected_for_context, relied_upon, reviewed_not_used." },
        verification_state: { type: "string", description: "Verification state: not_checked, human_checked, third_party_verified." }
      },
      required: ["session_id", "source_id", "source_type", "title"]
    }
  },
  {
    name: "airpp_record_generation",
    description: "Record an AI generation event — when an AI model produced a draft, suggestion, or content block.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        block_id: { type: "string", description: "ID for the content block generated." },
        block_title: { type: "string" },
        input_refs: { type: "array", items: { type: "string" }, description: "Source IDs that were used as input." },
        ai_involvement: { type: "string", description: "Level of AI involvement: draft_assist, significant_contribution, heavily_ai_generated." },
        model: {
          type: "object",
          description: "The AI model used.",
          properties: { provider: { type: "string" }, service: { type: "string" }, model_id: { type: "string" } }
        },
        prompt_summary: { type: "string", description: "Brief summary of the prompt given to the AI (no confidential content)." }
      },
      required: ["session_id", "block_title"]
    }
  },
  {
    name: "airpp_record_review",
    description: "Record a human review event — when a human reviewed and approved or modified AI-generated content.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        actor_id: { type: "string", description: "ID of the reviewer actor." },
        review_type: { type: "string", description: "factual_check, editorial_review, legal_review, technical_review, final_sign_off." },
        review_outcome: { type: "string", description: "reviewed_no_changes, reviewed_with_edits, approved, rejected." },
        notes: { type: "string" },
        attestation_statement: { type: "string" },
        signed: { type: "boolean", description: "Whether this review is a formal signed attestation." }
      },
      required: ["session_id", "review_outcome"]
    }
  },
  {
    name: "airpp_record_commit",
    description: "Record a code commit event binding this provenance session to a version control commit.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        commit_sha: { type: "string" },
        message: { type: "string" },
        repository: { type: "string" },
        branch: { type: "string" },
        pull_request: { type: "string" },
        files_changed: { type: "array", items: { type: "string" } }
      },
      required: ["session_id"]
    }
  },
  {
    name: "airpp_record_export",
    description: "Record an export event — when the report or output was exported to its final format.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        export_type: { type: "string", description: "pdf, docx, api_payload, email, print." },
        manifest_mode: { type: "string", description: "detached, embedded, api_transport." },
        file_name: { type: "string" }
      },
      required: ["session_id", "export_type"]
    }
  },
  {
    name: "airpp_finalise_manifest",
    description: "Finalise the AIRPP provenance manifest. Hashes the manifest, validates it against the AIRPP schema, and stores it in the registry. Returns the completed manifest and validation result.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" }
      },
      required: ["session_id"]
    }
  },
  {
    name: "airpp_validate_manifest",
    description: "Validate an AIRPP manifest JSON object against the v0.2.0 schema without storing it.",
    inputSchema: {
      type: "object",
      properties: {
        manifest: { type: "object", description: "The AIRPP manifest JSON to validate." }
      },
      required: ["manifest"]
    }
  },
  {
    name: "airpp_list_extensions",
    description: "List the AIRPP protocol extensions registered in the registry.",
    inputSchema: { type: "object", properties: {} }
  }
];

// ─── Transport helpers ────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

// ─── Registry API caller ──────────────────────────────────────────────────

async function registryCall(method, path, body = null) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(`${REGISTRY_URL}/api/v1${path}`, opts);
  const data = await res.json();
  return data;
}

// ─── Tool handler ─────────────────────────────────────────────────────────

async function callTool(name, args) {
  switch (name) {
    case "airpp_start_manifest":
      return registryCall("POST", "/mcp/start-manifest", { title: args.title, output_type: args.output_type, actor: args.actor });

    case "airpp_record_source":
      return registryCall("POST", "/mcp/record-source", args);

    case "airpp_record_generation":
      return registryCall("POST", "/mcp/record-generation", {
        ...args,
        model: args.model || { provider: "unknown_or_redacted", service: "unknown", model_id: "not_disclosed" },
        prompt_record: args.prompt_summary ? { capture_mode: "summary", prompt_summary: args.prompt_summary } : undefined
      });

    case "airpp_record_review":
      return registryCall("POST", "/mcp/record-review", args);

    case "airpp_record_commit":
      return registryCall("POST", "/mcp/record-commit", args);

    case "airpp_record_export":
      return registryCall("POST", "/mcp/record-export", args);

    case "airpp_finalise_manifest":
      return registryCall("POST", "/mcp/finalise-manifest", args);

    case "airpp_validate_manifest":
      return registryCall("POST", "/validate", args.manifest);

    case "airpp_list_extensions":
      return registryCall("GET", "/extensions");

    default:
      return { ok: false, error: "unknown_tool" };
  }
}

// ─── MCP stdio message loop ───────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2025-03-26",
        serverInfo: { name: "airpp-mcp-server", version: "0.3.0" },
        capabilities: { tools: {} }
      }
    });
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    try {
      const result = await callTool(toolName, toolArgs);
      send({
        jsonrpc: "2.0", id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: result?.ok === false
        }
      });
    } catch (err) {
      sendError(id, -32000, err.message);
    }
    return;
  }

  sendError(id, -32601, `Method not found: ${method}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
