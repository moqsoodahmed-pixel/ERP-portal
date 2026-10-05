# Architecture

A **modular monolith**: one Express process, one MongoDB database, strict internal layering. Modules can later be split into services because each depends only on injected collaborators (`src/container.js` is the composition root).

```
request -> requestId -> logger -> helmet/CORS -> body limit (100kb) -> sanitize -> rate limit
        -> route -> authenticate -> resolveTenant | requireVendorAssignment -> requirePermission
        -> [idempotency] -> validate (zod, strict) -> controller -> service -> repository -> MongoDB
```

| Layer | Responsibility | Rule |
|---|---|---|
| routes | wiring only | no business logic |
| middlewares | authN, authZ, tenant resolution, validation, limits | identity is derived server-side |
| controllers | HTTP <-> service translation | no DB access |
| services | business rules, audit calls | receive a server-built `ctx` |
| repositories | all DB access | tenant data only via `TenantRepository` |
| integrations | Tally / GST / notifications ports | interfaces + clearly marked placeholders |

## Business architecture

```
MASTER ADMIN --+-- CLIENTS (tenants) -> Products/Customers -> GST billing -> Invoice --+-- Tally (Phase 6)
               |                                                                       +-- GST filing (Phase 7-8)
               +-- GST VENDORS -> assigned clients only ----------------------------------^
MASTER ADMIN monitoring <- audit logs, filing status, sync status
```

## Status of each module (honest)

| Area | State |
|---|---|
| Auth, refresh rotation, lockout, RBAC, tenant isolation, audit, security events | **Implemented + tested** |
| Clients (create/list/get/update/status), users (list/create), vendors + assignments | **Implemented + tested** |
| Products, customers (CRUD + archive), invoices (create draft, list, get, cancel) | **Implemented + tested**; GST maths is a *foundation* pending tax review |
| Idempotency (invoice creation) | **Implemented + tested** |
| Encryption service | **Implemented + tested**; not yet applied to stored data (Tally credentials, Phase 6) |
| Tally integration | **PLACEHOLDER** (ports only) |
| GST filing workflow, GST portal APIs | **PLACEHOLDER** (models + statuses only) |
| Dashboards (client/master/vendor), reports (6) + synchronous CSV export, in-app notifications (Phase 9) | **Implemented + tested** — endpoints in the live OpenAPI (`/api/docs`); rules in `api-guidelines.md` (Phase 9 section) |
| Data-request workflows, email/SMS notification delivery (`integrations/notifications` port), background jobs | **PLACEHOLDER** |

## Folder map
`backend/src/{config,constants,controllers,middlewares,models,repositories,services,validators,utils,security,audit,integrations,jobs,routes,docs,scripts}`;
`frontend/src/{components,layouts,pages,routes,hooks,services,context,utils,constants,permissions,features/*}`.
