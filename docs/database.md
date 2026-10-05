# Database (MongoDB + Mongoose)

29 models (see `backend/src/models/`). Every tenant-owned collection has a required, indexed `tenantId`.

| Group | Models |
|---|---|
| Identity / RBAC | User, Role, Permission, UserRole (Role.permissions is the role->permission mapping) |
| Tenancy | Tenant, BusinessProfile, Vendor, VendorClientAssignment |
| Business | Product, Customer, Invoice (embedded `InvoiceItem` snapshot schema), GSTConfiguration |
| Tally | TallyIntegration (encrypted credentials, `select:false`), TallySyncLog |
| GST | GSTFiling, GSTFilingStatusHistory (append-only) |
| Platform | AuditLog (append-only), RefreshToken, SecurityEvent, Notification, FileMetadata, Counter, IdempotencyKey |
| Privacy | ConsentRecord, DataRequest, PrivacyNotice, PrivacyNoticeVersion (append-only), RetentionPolicy, DataProcessor |

## Notifications (Phase 9)
`Notification` (extended in place from the Phase 1 placeholder): `tenantId` (required), `recipientUserId`, `type`, `title`, `message`, `severity` (INFO/WARNING/CRITICAL), `entityType`, `entityId`, `actionUrl`, `isRead`, `readAt`, `dedupKey`. Indexes: `(recipientUserId, createdAt desc)`, `(recipientUserId, isRead, createdAt desc)`, `(tenantId, createdAt desc)`, unique `(recipientUserId, dedupKey)` (generation idempotency). `tallysynclogs (invoiceId)` was added for the report/dashboard `$lookup`.

## Money
Stored as `Decimal128`, serialised to exact decimal strings, computed with `decimal.js`. GST rate is a `Number` (percent, <= 2 dp) converted to Decimal before use.

## Soft delete
`isDeleted / deletedAt / deletedBy` on User, Tenant, Vendor, Product, Customer, Invoice. Repositories hide deleted rows. Invoices are cancelled (status), products/customers archived; nothing is physically deleted by the API.

## Indexing strategy
Compound indexes are tenant-first so every tenant query is index-covered.
`users.email` (unique) - `products (tenantId, productCode)` unique - `customers (tenantId, customerCode)` unique - `invoices (tenantId, invoiceNumber)` unique, `(tenantId, invoiceStatus)`, `(tenantId, createdAt desc)`, `(tenantId, customerId)`, `(tenantId, invoiceDate desc)` - `vendorclientassignments (vendorId, tenantId)` unique for ACTIVE rows - `gstfilings (tenantId, returnType, period)` unique, `(vendorId, tenantId)` - `tallysynclogs (tenantId, invoiceId, startedAt)`, `(tenantId, requestReference)` unique - `auditlogs (tenantId, timestamp)`, `(actorId, timestamp)`, `(action, timestamp)` - `refreshtokens.tokenHash` unique + TTL on `expiresAt` - `idempotencykeys (tenantId, scope, key)` unique + TTL.
Avoided on purpose: per-field indexes that no query uses; text indexes (search currently uses an escaped, case-insensitive regex on bounded result pages - revisit with Atlas Search / text index when data volume requires).

## Pagination
Offset (`page`/`limit`, max 100) today. For very large collections (invoices, audit logs) switch to keyset pagination on `(tenantId, _id)` or `(tenantId, createdAt)`; the repository `findPage` is the single place to change.

## Sequences
Codes (`PROD-000001`, `INV-000001`, ...) come from an atomic per-tenant `Counter` (`$inc` upsert), unique per tenant and race-free.

## Transactions
MongoDB transactions need a replica set. Multi-step flows (e.g. create client + admin) are currently ordered with pre-checks and not wrapped in a transaction; use a replica set + sessions in production and move these into `session.withTransaction` (tracked for Phase 2 hardening).
