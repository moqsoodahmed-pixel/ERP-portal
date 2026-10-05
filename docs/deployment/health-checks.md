# Health checks

Implemented in `backend/src/app.js`, registered before any auth/rate-limit middleware so they're always
reachable and lightweight.

| Endpoint | Purpose | Checks | Status codes |
|---|---|---|---|
| `GET /health` | Liveness — is the process alive at all | nothing beyond "the event loop responded" | `200` always (if the process can respond) |
| `GET /ready` | Readiness — can this instance actually serve traffic | `mongoose.connection.readyState === 1` | `200` ready / `503` not ready |
| `GET /version` | Deployment verification | reads `package.json` version + `NODE_ENV` | `200` |

None of the three expose the database URI, credentials, stack traces, or any internal detail — verified
by reading the handlers directly (`app.js`); they return small hardcoded JSON objects only.

## Wiring these up

- **EC2/Nginx**: the example config proxies `/health`, `/ready`, `/version` straight through (see
  `infrastructure/nginx/nginx.conf.example`); point any uptime monitor (e.g. UptimeRobot, Route 53
  health check) at `https://<domain>/ready` — it reflects actual DB connectivity, not just "Nginx is up".
- **PM2**: the Docker `HEALTHCHECK` in `backend/Dockerfile` already calls `/health`; if you later run
  this backend in a container on EC2 instead of bare PM2, that's reused automatically.
- **Render**: set the Web Service's health check path to `/ready` in the dashboard so Render won't route
  traffic to an instance that can't reach MongoDB yet.

## What's intentionally not implemented

A `/ready` check that also pings Tally or other external integrations was deliberately left out — those
are per-tenant, optional integrations, not infrastructure the whole application depends on being up.
