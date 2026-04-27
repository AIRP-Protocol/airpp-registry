Continue the AIRPP Registry MVP from the generated `airpp-registry-mvp` project.

Context:
- AIRPP v0.2.0 is frozen as a public draft.
- The MVP includes an Express/Node server, JSON Schema validator, public web UI, implementation registry, extension registry, MCP-style provenance event capture, Postgres schema and Docker Compose.
- The next task is to harden it into a deployable public service.

Priorities:
1. Add real authentication and organisation accounts.
2. Replace bootstrap API key with scoped API keys.
3. Add rate limiting and audit logs to all write endpoints.
4. Add downloadable validation reports.
5. Add a proper MCP server wrapper around the existing HTTP MCP functions.
6. Add GitHub OAuth / GitHub App flow for commit and PR binding.
7. Add signed attestation support.
8. Add public/private manifest handling and redaction controls.
9. Keep AIRPP vendor-neutral and separate from Anemtrix.
