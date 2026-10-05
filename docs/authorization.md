# Authorization (RBAC)

Roles: `MASTER_ADMIN`, `CLIENT_ADMIN`, `CLIENT_USER`, `GST_VENDOR`.

Effective permissions = **role defaults** (`constants/permissions.js`) + for tenant roles only: per-user `grantedPermissions` and custom `Role`s linked via `UserRole`, **filtered to grantable permissions**. Platform permissions (`clients.*`, `vendors.*`, `audit.view`, `platform.view`, `tally.manage`) can never be granted to tenant users. Master and vendor accounts cannot be extended.

Enforcement order for tenant routes: `authenticate -> resolveTenant -> requirePermission`. Denials are logged as `AUTHORIZATION_DENIED` security events.

Least-privilege guard: a user can only grant permissions they hold themselves; only a Master Admin can create a `CLIENT_ADMIN`.

Permission vocabulary: `view, create, update, delete, export, approve, sync` across `clients, users, vendors, products, customers, invoices, gst, tally, reports, business, audit, platform, dataRequests`.

Phase 9: `dashboard.view` gates every dashboard; reports need `reports.view` (export: `reports.export`) **plus** the module permission of the report (e.g. `invoice-summary` also needs `invoices.view`). `GST_VENDOR` holds `reports.view` by default but can only reach reports through `/vendors/me/clients/:tenantId/reports/*`, which runs the Phase 7 `requireVendorAssignment` chain. Notifications require authentication only — every query is scoped to the caller's own user id.

The frontend mirrors permissions for navigation only (`src/permissions`); it is a UX aid, never a control.
