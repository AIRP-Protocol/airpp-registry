# Deployment Notes

## MVP deployment

Use Docker Compose for the simplest deployment:

```bash
docker compose up --build
```

## Production notes

Before public deployment:

- Set a strong `AIRPP_BOOTSTRAP_API_KEY`.
- Put the server behind HTTPS.
- Use managed Postgres.
- Add proper user authentication.
- Add rate limiting.
- Disable in-memory mode.
- Decide whether manifests are stored, hashed only, or stored with redactions.
- Add privacy notices and terms.
