# AIRPP Registry v0.3.0

**AI Report Provenance Protocol — Registry, Validator and MCP Provenance Server**

Public protocol registry, manifest validator, implementation registry and MCP-style provenance sandbox for AIRPP v0.2.0 (frozen public draft).

---

## What's new in v0.3.0

- **Real authentication** — email/password registration, JWT session tokens, email verification, password reset
- **Organisation accounts** — multi-tenant with member invitation flow
- **Scoped API keys** — per-org keys stored as SHA-256 hashes, revocable, with last-used tracking
- **GitHub OAuth** — link GitHub identity to registry accounts
- **Rate limiting** — per-window limits on all API routes, tighter limits on `/validate` and auth endpoints
- **Audit log** — every write, validation run, MCP event and auth action recorded with IP, user agent, actor
- **Downloadable validation reports** — structured JSON report auto-generated for every validation and manifest store call
- **Manifest visibility** — public/private control with org-scoped access enforcement
- **Signed attestations** — `POST /api/v1/manifests/:id/attestations` with signature metadata
- **Formal MCP server** — `mcp-server/airpp-mcp-server.js` — stdio MCP 2025-03-26 protocol, 9 tools, Claude Desktop ready
- **Migration runner** — `npm run migrate` applies numbered SQL migrations idempotently
- **Payload size guard** — manifests over 512 KB rejected with 413

---

## Quick start (local / in-memory demo)

```bash
npm install
cp .env.example .env
npm run dev
```

Open: http://localhost:8787

Run tests:
```bash
npm test
```

---

## Docker / Postgres deployment

```bash
cp .env.example .env
# Edit .env — set AIRPP_BOOTSTRAP_API_KEY, JWT_SECRET, PUBLIC_BASE_URL
docker compose up --build
```

Apply migrations manually (if not using Docker entrypoint):
```bash
npm run migrate
```

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8787` | Server port |
| `NODE_ENV` | `development` | `production` requires `DATABASE_URL` |
| `DATABASE_URL` | — | Postgres connection string. Unset = in-memory demo |
| `AIRPP_BOOTSTRAP_API_KEY` | — | Legacy bootstrap key. Replace with scoped keys. |
| `JWT_SECRET` | dev secret | Must be a long random string in production |
| `JWT_EXPIRES_IN` | `24h` | JWT session token lifetime |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | — | Email delivery. Unset = console logging |
| `SMTP_FROM` | `noreply@registry.airpp.dev` | Sender address |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | — | GitHub OAuth. Unset = disabled |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `RATE_LIMIT_MAX` | `60` | Max requests per window (general) |
| `RATE_LIMIT_VALIDATE_MAX` | `20` | Max validate requests per window |
| `MAX_MANIFEST_BYTES` | `524288` | Max manifest payload (512 KB) |
| `PUBLIC_BASE_URL` | `http://localhost:8787` | Canonical public URL |

---

## API reference

### Public endpoints
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check |
| `GET` | `/api/v1/spec` | AIRPP v0.2.0 specification (Markdown) |
| `GET` | `/api/v1/schema/0.2.0` | JSON Schema |
| `GET` | `/api/v1/examples/basic` | Basic manifest example |
| `GET` | `/api/v1/examples/auditable` | Auditable manifest example |
| `GET` | `/api/v1/extensions` | List registered extensions |
| `GET` | `/api/v1/implementations/public` | Public implementation registry |
| `POST` | `/api/v1/validate` | Stateless manifest validation (rate-limited) |
| `GET` | `/api/v1/validation-runs/:id/report` | Download structured validation report |

### Auth endpoints (`/api/v1/auth`)
| Method | Path | Description |
|---|---|---|
| `POST` | `/register` | Create account + organisation |
| `GET` | `/verify-email?token=` | Verify email address |
| `POST` | `/login` | Email/password login → JWT |
| `POST` | `/forgot-password` | Request password reset email |
| `POST` | `/reset-password` | Reset password with token |
| `GET` | `/me` | Current user (JWT required) |
| `POST` | `/api-keys` | Create scoped API key |
| `GET` | `/api-keys` | List org API keys |
| `DELETE` | `/api-keys/:id` | Revoke API key |
| `POST` | `/invite` | Invite a team member by email |
| `POST` | `/accept-invite` | Accept invitation + create account |
| `GET` | `/github` | GitHub OAuth redirect |
| `GET` | `/github/callback` | GitHub OAuth callback |

### Authenticated endpoints (JWT or scoped API key)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/implementations` | Register an implementation |
| `POST` | `/api/v1/manifests` | Store + validate a manifest |
| `GET` | `/api/v1/manifests` | List org manifests |
| `GET` | `/api/v1/manifests/:id` | Get manifest (visibility enforced) |
| `POST` | `/api/v1/manifests/:id/attestations` | Create attestation |
| `GET` | `/api/v1/manifests/:id/attestations` | List attestations |
| `GET` | `/api/v1/validation-runs` | List validation runs |
| `GET` | `/api/v1/audit-log` | Audit event log (org-scoped) |
| `POST` | `/api/v1/mcp/start-manifest` | Start MCP session |
| `POST` | `/api/v1/mcp/record-source` | Record source |
| `POST` | `/api/v1/mcp/record-generation` | Record AI generation |
| `POST` | `/api/v1/mcp/record-review` | Record human review |
| `POST` | `/api/v1/mcp/record-commit` | Record code commit |
| `POST` | `/api/v1/mcp/record-export` | Record export |
| `POST` | `/api/v1/mcp/finalise-manifest` | Finalise + store + validate |
| `GET` | `/api/v1/mcp/sessions/:session_id` | Get MCP session state |

---

## MCP server (Claude Desktop / VS Code)

```bash
export AIRPP_REGISTRY_URL=https://registry.airpp.dev
export AIRPP_API_KEY=airpp_your-scoped-key

node mcp-server/airpp-mcp-server.js
```

Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "airpp": {
      "command": "node",
      "args": ["/path/to/airpp-registry-mvp/mcp-server/airpp-mcp-server.js"],
      "env": {
        "AIRPP_REGISTRY_URL": "https://registry.airpp.dev",
        "AIRPP_API_KEY": "airpp_your-scoped-key"
      }
    }
  }
}
```

---

## Migrations

| File | Purpose |
|---|---|
| `001_init.sql` | Baseline schema, AIRPP v0.2.0 version seed, extensions |
| `002_auth.sql` | User accounts, org membership, scoped API keys, invitations |
| `003_reports.sql` | Validation reports table, manifest visibility field |
| `004_attestations.sql` | Attestation signatures, audit event enrichment |

---

## Deployment (Render)

1. Create a **Web Service** from this repo, runtime Node 22
2. Add a **PostgreSQL** database, copy the connection string to `DATABASE_URL`
3. Set env vars: `AIRPP_BOOTSTRAP_API_KEY`, `JWT_SECRET`, `PUBLIC_BASE_URL`, SMTP config
4. Set start command: `npm run migrate && npm start`
5. Set health check path: `/api/v1/health`

---

## Security hardening checklist

- [x] Bootstrap API key guard on write endpoints
- [x] Scoped API keys hashed with SHA-256 at rest
- [x] JWT session tokens with configurable expiry
- [x] Rate limiting on all API routes
- [x] Tight rate limiting on auth and validate routes
- [x] Payload size limit (512 KB)
- [x] Audit log on all writes
- [x] Private/public manifest visibility
- [x] Password hashing (bcryptjs, cost 12)
- [x] Email enumeration prevention on forgot-password
- [x] `trust proxy` configured for Render/Fly edge
- [ ] Replace bootstrap key with scoped keys (first post-deploy task)
- [ ] Enable SMTP for production email delivery
- [ ] Configure GitHub OAuth app for production callback URL
- [ ] Add signed attestation verification (future: `004_attestations.sql` signature field)

---

## Licence

AIRPP is vendor-neutral open protocol infrastructure. This registry implementation is separate from any individual vendor product.
