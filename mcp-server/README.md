# AIRPP MCP Server

A formal Model Context Protocol (MCP) server that exposes AIRPP provenance capture as MCP tools, enabling any MCP-compatible AI host (Claude Desktop, VS Code, etc.) to capture structured provenance automatically.

## Quick start

```bash
# Point at your registry
export AIRPP_REGISTRY_URL=https://registry.airpp.dev
export AIRPP_API_KEY=your-scoped-api-key

# Run via stdio
node mcp-server/airpp-mcp-server.js
```

## Claude Desktop configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "airpp": {
      "command": "node",
      "args": ["/path/to/airpp-registry-mvp/mcp-server/airpp-mcp-server.js"],
      "env": {
        "AIRPP_REGISTRY_URL": "https://registry.airpp.dev",
        "AIRPP_API_KEY": "your-scoped-api-key"
      }
    }
  }
}
```

## Available tools

| Tool | Description |
|------|-------------|
| `airpp_start_manifest` | Start a provenance session |
| `airpp_record_source` | Record a source used as AI context |
| `airpp_record_generation` | Record an AI generation event |
| `airpp_record_review` | Record a human review step |
| `airpp_record_commit` | Bind to a code commit |
| `airpp_record_export` | Record export to final format |
| `airpp_finalise_manifest` | Hash, validate and store the manifest |
| `airpp_validate_manifest` | Stateless validation without storing |
| `airpp_list_extensions` | List registered AIRPP extensions |

## Typical workflow

```
airpp_start_manifest → airpp_record_source → airpp_record_generation
  → airpp_record_review → airpp_record_export → airpp_finalise_manifest
```
