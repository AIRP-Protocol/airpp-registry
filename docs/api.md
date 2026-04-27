# AIRPP Registry API

## Validate manifest

```http
POST /api/v1/validate
Content-Type: application/json
```

## Register implementation

```http
POST /api/v1/implementations
Authorization: Bearer <key>
Content-Type: application/json
```

## MCP session flow

```text
POST /api/v1/mcp/start-manifest
POST /api/v1/mcp/record-source
POST /api/v1/mcp/record-generation
POST /api/v1/mcp/record-review
POST /api/v1/mcp/record-commit
POST /api/v1/mcp/finalise-manifest
```
