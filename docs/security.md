# Security

## Implemented controls
Helmet headers; CORS allow-list with credentials; 100 kB body limit; operator/dotted-key stripping on body/query/params + strict zod validation; per-endpoint-group rate limits; JWT access + rotating refresh tokens; bcrypt; account lockout; centralised error handler (no stack traces to clients); request ids; structured JSON logs (pino) with secret redaction; append-only audit log; security events (login failures, lockouts, token reuse, tenant violations, authorization denials, rate limits); response serialiser that strips secret-named fields; production start-up refuses placeholder secrets, wildcard CORS, or disabled rate limiting; `/health` and `/ready` expose no infrastructure details.

## Secrets
Only via environment variables (`backend/.env.example`). `.env*` is git-ignored and CI fails if one is tracked. `docker-compose.yml` contains **development-only throw-away** values. In production inject from a secret manager.

## Encryption (`security/encryption.js`)
| Question | Answer |
|---|---|
| What | Sensitive *credentials/secrets* (Tally connector credentials, future API keys) via AES-256-GCM; passwords and refresh tokens are hashed, not encrypted |
| Why not everything | Encrypted fields cannot be indexed/searched; business data (invoices, customers) relies on database/disk encryption at rest and TLS in transit |
| Keys | `ENCRYPTION_KEY` (base64, 32 bytes) from the environment/secret manager, never in source |
| Rotation | Set the new key as `ENCRYPTION_KEY` and the old one as `ENCRYPTION_KEY_PREVIOUS`; ciphertext carries a key id; `needsRotation()` identifies rows to re-encrypt via a migration job (job: Phase 6); remove the old key afterwards |
| Failures | Authenticated encryption detects tampering; failure raises `DECRYPTION_FAILED` (500, generic message) and is logged without plaintext |
Currently implemented and unit-tested; no stored field uses it yet.

## File uploads (architecture only)
`FileMetadata` + object-storage abstraction are modelled (size cap, checksum, scan status, tenant key prefix). No upload endpoint exists; Phase 5 must add MIME/magic-byte validation, malware scanning and pre-signed access.

## Known gaps / TODO
MFA; password reset; CSP tuning for the production frontend host; dependency & container scanning in CI beyond `npm audit`; MongoDB transactions (needs replica set); field-level encryption rollout; log shipping and alerting.
