# AIRPP MCP Binding

The MVP exposes HTTP endpoints that behave like MCP provenance tools. A later pass can wrap the same functions in a formal MCP server.

## Tool equivalents

- `airpp.start_manifest`
- `airpp.record_source`
- `airpp.record_generation`
- `airpp.record_review`
- `airpp.record_commit`
- `airpp.finalise_manifest`
- `airpp.verify_manifest`

Each call appends an event and updates the current manifest.
