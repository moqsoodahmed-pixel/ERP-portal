# ERP Platform - foundation

Multi-tenant **ERP + GST billing + Tally integration + GST filing workflow** platform. This repository is the **foundation phase**: architecture, security, tenancy, RBAC, audit, a thin vertical slice (clients, users, vendors, products, customers, draft invoices) and honest placeholders for everything else.

> Designed for ISO/IEC 27001:2022 alignment and DPDP compliance readiness. It is **not** certified or legally compliant; see `docs/compliance`. Tally, GST-portal, payment, email/SMS and object-storage integrations are **not implemented**.

## Stack
Node.js 22 - Express 4 - MongoDB + Mongoose - JavaScript (ESM) - React 19 + Vite + React Router - JWT (access) + rotating refresh cookie - zod - pino - decimal.js - OpenAPI/Swagger - `node:test` (backend) / Vitest (frontend).

## Structure
```
backend/    Express API (src/{config,constants,controllers,middlewares,models,repositories,services,validators,security,audit,integrations,jobs,routes,docs,scripts}, tests/)
frontend/   React app (src/{components,layouts,pages,routes,hooks,services,context,permissions,features/*})
docs/       architecture, database, auth, authorization, multi-tenancy, API, Tally, GST, security, compliance/, deployment/
infrastructure/  docker, nginx example, deployment placeholders      scripts/  verify.sh
```

## Quick start (local)
Prerequisites: Node >= 20 (22 recommended), MongoDB 7 (or Docker).
```bash
# 1. Backend
cd backend && cp .env.example .env     # fill JWT_* and ENCRYPTION_KEY (commands are in the file)
npm install
npm run seed                           # DEV ONLY demo data (refuses to run in production)
npm run dev                            # http://localhost:4000  - Swagger: /api/docs

# 2. Frontend (new terminal)
cd frontend && cp .env.example .env && npm install && npm run dev   # http://localhost:5173

# Or everything with Docker (dev-only secrets inside docker-compose.yml)
docker compose up
```
Seeded **development-only, fake** accounts (password `DevOnly-ChangeMe-123`): `master.admin@example.test`, `client.admin@example.test`, `client.user@example.test`, `gst.vendor@example.test`.

## Tests and checks
```bash
cd backend  && npm run lint && npm test          # 78 pass offline; real-MongoDB suite runs when MONGODB_TEST_URI is set (CI does)
cd frontend && npm run lint && npm test && npm run build
./scripts/verify.sh                              # same as CI
```
`MONGODB_TEST_URI=mongodb://localhost:27017 npm test` runs `tests/integration/mongo.test.js` against a real database. Without it the suite is **skipped** (reported as skipped, not passed).

## Environment variables
See `backend/.env.example`: `NODE_ENV, PORT, MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_EXPIRES_IN, JWT_REFRESH_EXPIRES_IN, CORS_ORIGIN, TALLY_API_URL, TALLY_API_KEY, ENCRYPTION_KEY` (+ optional `ENCRYPTION_KEY_PREVIOUS, BCRYPT_COST, LOGIN_MAX_ATTEMPTS, LOCKOUT_MINUTES, LOG_LEVEL, TRUST_PROXY`). Production start-up fails on placeholder/weak secrets.

## Security & tenancy in one paragraph
Identity, tenant and permissions are derived server-side on every request. Tenant data is reachable only through `TenantRepository` (tenant id mandatory, applied last). Master Admin must name a tenant explicitly (`X-Admin-Tenant-Id`) and every such access is audited. GST vendors only reach clients with an ACTIVE assignment, checked per request. Details: `docs/security.md`, `docs/multi-tenancy.md`.

## Development phases
1 Auth+Security+RBAC+Tenancy *(foundation done)* - 2 Master Admin+Client mgmt - 3 Business setup+Products+Customers - 4 GST billing/invoice engine - 5 Invoice PDF+documents - 6 Tally integration - 7 GST vendor workflow - 8 Filing progress+reporting - 9 Notifications+audit+advanced reports - 10 Compliance hardening+security testing - 11 Production infrastructure - 12 Deployment+monitoring+backup+DR.

## Known placeholders
Tally sync, GST filing workflow/portal APIs, reports/exports, data-request workflows, notifications, file upload/storage, background jobs, password reset, MFA, payment gateway. They return `501 NOT_IMPLEMENTED` (API) or show a "Not implemented" notice (UI).
