# Multi-tenancy

**Model**: shared database, shared collections, `tenantId` discriminator on every tenant-owned document.

**Where isolation is enforced (defence in depth)**
1. `resolveTenant` derives the tenant from the authenticated user. Client roles cannot choose a tenant: a `tenantId` in the query/body that differs from their own returns 403 and logs `TENANT_ACCESS_VIOLATION`; the field is then stripped.
2. `TenantRepository` is the only data-access path for tenant data. `tenantId` is a mandatory first argument, validated as an ObjectId, applied *last* in the filter (cannot be overridden), ignored in payloads, and unmodifiable on update.
3. Services resolve every referenced id (customer, products) through tenant-scoped repositories, so another tenant's ids simply do not exist.
4. Strict zod schemas reject unknown fields (no mass assignment).
5. Compound indexes are tenant-first.

**Master Admin**: platform routes (`/clients`, `/vendors`, `/audit-logs`) need no tenant. To touch a client's data the admin must send `X-Admin-Tenant-Id`; each such request is recorded as `ADMIN_TENANT_ACCESS`. Master Admin has view-only access to client data by default.

**GST vendors**: access is through `/vendors/me/clients/:tenantId/...` guarded by `requireVendorAssignment`, which checks an ACTIVE `VendorClientAssignment` for (authenticated vendor, tenant) on **every** request, records `VENDOR_DATA_ACCESS`, and sets the tenant. Unassigning takes effect immediately.

**Tests**: `backend/tests/api/tenantIsolation.test.js` (Client A vs B invoice/product/customer, tenantId tampering, cross-tenant references, vendor assigned/unassigned, client->master APIs, master context + audit) and `tests/unit/repository.test.js`. `tests/integration/mongo.test.js` repeats key checks on a real MongoDB when available.
