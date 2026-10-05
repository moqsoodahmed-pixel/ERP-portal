# Render (Option B)

This is a runbook, not a record of a service that was actually provisioned.

## Important constraint: file storage

Render's filesystem is ephemeral — it is wiped on every deploy/restart, and if you ever scale to more
than one instance, each instance has its own disk. The backend currently stores generated PDFs/documents
on local disk (`backend/src/services/storage.service.js`). **On Render, generated documents will be lost
on every redeploy** unless you either (a) stay at a single instance and accept that documents are lost on
redeploy/restart (acceptable only for early-stage/demo use), or (b) implement the S3-compatible storage
adapter described in [file-storage.md](./file-storage.md) before relying on Render for real tenant data.
This repository does not implement that adapter yet — documented here as a blocking prerequisite for a
real Render production deployment, not silently worked around.

## 1. Database

Provision a MongoDB Atlas cluster (see [mongodb.md](./mongodb.md)) — Render does not host MongoDB itself.

## 2. Backend service

- New Render **Web Service**, connect your repo, root directory `backend/`.
- Build command: `npm ci --omit=dev`
- Start command: `node src/server.js`
- Environment: set every variable from `backend/.env.example` (see
  [environment-variables.md](./environment-variables.md)) in Render's dashboard — `NODE_ENV=production`,
  real `MONGODB_URI` (Atlas), generated JWT/encryption secrets, `CORS_ORIGIN` set to the frontend's
  Render URL, `TRUST_PROXY=1` (Render terminates TLS in front of your service).
- Health check path: `/ready` (verifies MongoDB connectivity, not just process liveness).
- Render captures stdout/stderr as platform logs automatically — no PM2/log-rotation setup needed here
  (that's EC2-specific).

## 3. Frontend service

- New Render **Static Site**, root directory `frontend/`.
- Build command: `npm ci && npm run build`
- Publish directory: `dist`
- Rewrite rule: `/* -> /index.html` (200) for SPA deep-link refresh.
- Environment: `VITE_API_BASE_URL` pointing at the backend service's public URL (e.g.
  `https://erp-backend.onrender.com/api/v1`), since a Static Site and a Web Service are different
  origins on Render — unlike the EC2 same-origin Nginx setup, CORS is actually in play here. Make sure
  `CORS_ORIGIN` on the backend includes the frontend's exact Render URL.

## 4. Verify

```sh
curl https://<backend>.onrender.com/health
curl https://<backend>.onrender.com/ready
curl https://<backend>.onrender.com/version
```

Then run the [smoke-test checklist](./smoke-tests.md) against the real URLs.

## Redeploying / rollback

Render keeps previous deploys and supports one-click rollback to a prior successful deploy in its
dashboard — use that for rollback rather than any script in this repository. See
[rollback.md](./rollback.md) for the general procedure and what to check before/after.
