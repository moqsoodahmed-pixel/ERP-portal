# Environment variables

Backend variables are validated centrally at startup by `backend/src/config/env.js` (zod schema). An
invalid or missing **required** variable throws immediately and the process never starts — the
application will not run in a half-configured state. Placeholders live in `backend/.env.example` and
`frontend/.env.example`; never commit real values.

## Backend (`backend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `development` \| `test` \| `production`. Production enables extra startup checks (below). |
| `PORT` | no (default `4000`) | |
| `MONGODB_URI` | yes | Connection string. Never logged — only a generic "connected"/"connect failed" event is logged. |
| `JWT_ACCESS_SECRET` | yes | ≥32 chars. Must differ from `JWT_REFRESH_SECRET` in production. |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars. |
| `JWT_ACCESS_EXPIRES_IN` | no (default `15m`) | |
| `JWT_REFRESH_EXPIRES_IN` | no (default `7d`) | |
| `CORS_ORIGIN` | yes | Comma-separated allowlist of frontend origin(s). Wildcard `*` is rejected in production. |
| `ENCRYPTION_KEY` | yes | Base64, 32 bytes. Encrypts Tally credentials at rest (AES-256-GCM). |
| `ENCRYPTION_KEY_PREVIOUS` | no | Set only during a key-rotation window; lets old ciphertext still decrypt. |
| `TALLY_API_URL` / `TALLY_API_KEY` | no | Only needed once a tenant configures Tally. |
| `BCRYPT_COST` | no (default `12`) | |
| `LOGIN_MAX_ATTEMPTS` / `LOCKOUT_MINUTES` | no (defaults `5` / `15`) | |
| `LOG_LEVEL` | no (default `info`) | pino level. |
| `TRUST_PROXY` | no (default `0`) | Number of trusted reverse-proxy hops. Set to `1` behind a single Nginx/Render edge proxy so `req.ip` reflects the real client. |
| `COOKIE_SECURE` | no | Defaults to `true` in production, `false` otherwise. |
| `RATE_LIMIT_DISABLED` | no (default `false`) | **Cannot be `true` in production** — startup throws if it is. Development/test convenience only. |
| `DOCUMENT_STORAGE_PATH` | no | Local filesystem root for generated PDFs/documents. See [file-storage.md](./file-storage.md). |

### Production-only startup checks (`NODE_ENV=production`)

Enforced in `backend/src/config/env.js`, not optional:
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY` must not look like a placeholder (reject
  values starting with `change-me`, `dev-only`, `replace`).
- `JWT_ACCESS_SECRET` must differ from `JWT_REFRESH_SECRET`.
- `CORS_ORIGIN` must not contain `*`.
- `RATE_LIMIT_DISABLED` must not be `true`.

## Frontend (`frontend/.env`)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | no (default `/api/v1`) | Compile-time only (Vite bakes it into the bundle at build). Default assumes a same-origin reverse proxy forwarding `/api/` to the backend — the recommended setup, since it avoids a separate CORS origin in production. |
| `VITE_PROXY_TARGET` | dev-only | Only used by the Vite **dev server** proxy; never present in a production build. |

**Everything in `frontend/.env` ends up in the public JS bundle.** Never put a backend secret, API key,
or anything not meant for the browser into a `VITE_*` variable.
