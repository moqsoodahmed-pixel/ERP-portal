# Tally Public API

## Purpose

Some client companies do not expose a network-reachable Tally service for this ERP to connect to (that
existing direction — ERP calling out to a tenant's Tally instance — is documented in
`docs/tally-integration.md` and unchanged by this document). Instead, their Tally/TDL integration needs to
call **into** this ERP. This document describes that API.

## Architecture: two independent directions

```
             ERP
    ┌──────────────────────┐
    │ Existing Tally        │   ERP → Tally (Phase 6)
    │ Integration           │   docs/tally-integration.md
    │ (ERP -> Tally)         │
    ├──────────────────────┤
    │ Tally Public API       │   Tally/TDL → ERP (this document)
    │ (Tally/TDL -> ERP)      │
    └──────────────────────┘
```

These are separate code paths with separate authentication. A request on one never affects the other.

## Authentication

Every request must include:

```
X-Tally-API-Key: tk_live_<secret>
```

**The API key is tenant-specific.** The tenant is resolved entirely from the key record on the server —
it is never taken from any field in the request (body, query string, or any other header). A key issued
for Tenant A can never read or act on Tenant B's data, regardless of what the request claims.

There is no session, cookie, or ERP user JWT involved in this API. A missing, malformed, unknown,
revoked, or expired key all produce the same response, so a caller cannot distinguish "wrong key" from
"right key but revoked" from "right tenant, right key, but expired":

```json
{ "success": false, "error": { "code": "TALLY_API_KEY_INVALID", "message": "Invalid or missing API key" }, "requestId": "..." }
```
`401 Unauthorized` in every case above.

### Obtaining a key

A Business Admin (or Master Admin acting on a tenant's behalf) generates a key from **Tally → Tally API
keys** in the ERP UI, or via `POST /api/v1/tally/api-keys` (this management endpoint uses the normal ERP
JWT — it is for the human admin, not for Tally itself). The full secret is shown **exactly once**, at
creation or rotation time. If it is lost, rotate or create a new key — there is no "reveal again" feature,
by design: the database never stores a form of the key that could be shown back.

## Scopes

A key only has the scopes explicitly granted to it. Granting a key `tally:invoice:read` does not imply
`tally:sync` — each must be requested separately.

| Scope | Grants |
|---|---|
| `tally:company:read` | `GET /company` |
| `tally:customer:read` | `GET /customers` |
| `tally:product:read` | `GET /products` |
| `tally:invoice:read` | `GET /invoices`, `GET /invoices/:id` |
| `tally:sync` | `POST /invoices/:id/sync` |

A request without the required scope gets `403 Forbidden` (`AUTHORIZATION_ERROR`), not a 401 — the key
itself is valid, it just isn't allowed to do that specific thing.

There is currently no `tally:invoice:write` scope: this API has no endpoint that creates, edits, issues,
or cancels an invoice. Invoices remain created and managed only through the normal ERP (UI or JWT-
authenticated API) — this API is read-plus-sync only, by design (see "What this API will never do" below).

## Base URL

`https://<your-erp-domain>/api/v1/tally/public`

(Replace `<your-erp-domain>` with your actual deployed origin — see `docs/deployment/` for how this ERP
is deployed. No real domain is implied by this document.)

## Endpoints

All responses use the ERP's standard envelope: `{ "success": true, "data": ..., "requestId": "..." }` on
success, `{ "success": false, "error": { "code", "message", "details" }, "requestId": "..." }` on failure.

### `GET /company`

Returns the tenant's business profile, projected to the fields Tally needs.

```json
{ "success": true, "data": { "companyName": "Acme Traders", "gstin": "27AAAAA0000A1Z5", "state": "Maharashtra", "stateCode": "27" }, "requestId": "..." }
```

### `GET /customers`

Query params (all optional): `page`, `limit` (capped — see Pagination below), `search`, `status`,
`from`/`to` (ISO date, filters by last-updated window), `sort`.

```json
{ "success": true, "data": { "items": [
  { "id": "...", "customerCode": "CUST-0001", "name": "Example Customer", "businessName": null, "gstin": "27BBBBB1111B1Z5", "pan": null, "billingAddress": { "state": "Maharashtra", "stateCode": "27", "...": "..." }, "status": "ACTIVE", "updatedAt": "2026-01-01T00:00:00.000Z" }
], "pagination": { "page": 1, "limit": 50, "total": 1, "pages": 1 } } }
```

### `GET /products`

Same query params as `/customers`.

```json
{ "success": true, "data": { "items": [
  { "id": "...", "productCode": "PROD-0001", "productName": "Widget", "hsnSacCode": "8421", "unit": "NOS", "sellingPrice": "100.00", "gstRate": 18, "isGstApplicable": true, "status": "ACTIVE", "updatedAt": "..." }
], "pagination": { "...": "..." } } }
```

### `GET /invoices`

Query params: `page`, `limit`, `search`, `status` (`DRAFT`/`ISSUED`/`CANCELLED`), `from`/`to` (invoice
date range), `sort`.

```json
{ "success": true, "data": { "items": [
  { "id": "...", "invoiceNumber": "INV-2026-0001", "invoiceDate": "2026-04-01T00:00:00.000Z", "invoiceStatus": "ISSUED", "customerId": "...", "grandTotal": "1180.00", "gstApplicable": true, "interState": false, "updatedAt": "..." }
], "pagination": { "...": "..." } } }
```

Invoice figures are always the **authoritative, stored** values — this API never recalculates GST from
live customer/product/business-profile data, including for invoices whose customer/product/profile has
since changed. This is the same frozen-snapshot guarantee the rest of the ERP relies on (see
`docs/gst-workflow.md`).

### `GET /invoices/:id`

Full invoice detail, including line items and the frozen customer/supplier snapshots as they were at
issue time.

```json
{ "success": true, "data": {
  "id": "...", "invoiceNumber": "INV-2026-0001", "invoiceDate": "...", "invoiceStatus": "ISSUED",
  "customerId": "...", "grandTotal": "1180.00", "gstApplicable": true, "interState": false,
  "items": [ { "productId": "...", "quantity": "2", "unitPrice": "500.00", "taxableAmount": "1000.00", "cgst": "90.00", "sgst": "90.00", "lineTotal": "1180.00" } ],
  "customerSnapshot": { "name": "Example Customer", "gstin": "...", "billingAddress": { "...": "..." } },
  "supplierSnapshot": { "businessName": "Acme Traders", "gstin": "...", "address": { "...": "..." } },
  "taxableAmount": "1000.00", "cgst": "90.00", "sgst": "90.00", "igst": "0.00", "cess": "0.00",
  "paymentStatus": "UNPAID", "updatedAt": "..."
} }
```

If the invoice belongs to another tenant, or does not exist at all, the response is identically
`404 Not Found` — the API never reveals whether a given id exists in someone else's tenant.

### `POST /invoices/:id/sync`

Triggers the **same** Phase 6 Tally sync this ERP already performs for its own JWT-authenticated
`/invoices/:id/tally-sync` route — this endpoint does not duplicate that logic, it calls the identical
service. Same idempotency guarantee: a `SYNCED` invoice returns immediately with no new Tally call; a
`SYNCING` invoice returns `409 Conflict`; a `FAILED` sync is retried up to the tenant's configured
attempt limit.

```json
{ "success": true, "data": { "invoiceId": "...", "status": "SYNCED", "voucherId": "...", "voucherNumber": "SALE-001" }, "requestId": "..." }
```

Only an `ISSUED` invoice can be synced. The tenant's Tally configuration (base URL, ledgers, credentials)
must already be set up via the normal ERP Tally settings page — this API does not configure Tally, it
only triggers an already-configured sync.

## Pagination

Same pagination contract as the rest of the ERP's list endpoints: `limit` is capped server-side
(`PAGINATION.MAX_LIMIT`); `page`/`limit` outside the valid range is rejected with `400`, not silently
clamped. `search` is regex-escaped server-side before use — it is never passed to MongoDB as a raw
operator.

## Filtering

Only the documented query parameters above are read. Anything else in the query string is ignored, not
passed through to a database filter — in particular, a `tenantId` query parameter is always ignored; the
tenant comes exclusively from the API key.

## Response format

JSON only. Every endpoint returns `application/json`; there is no `Accept: application/xml` variant.
This is a deliberate decision, not an oversight (Phase 14): Tally's own XML-over-HTTP interface is what
the ERP speaks going **out** to Tally (Phase 6, `docs/tally-integration.md`), but an external Tally/TDL
*connector* calling **into** this API is expected to be a script (Node, Python, a TDL HTTP Collection,
etc.) for which JSON is simpler to consume than hand-parsed XML. If a real integration test surfaces a
genuine need for an XML response on a specific endpoint, that would be added as an explicit,
schema-controlled, escaped serializer behind content negotiation — not a wholesale protocol change — and
documented here before use.

## Errors

Standard ERP error envelope. Common codes: `VALIDATION_ERROR` (400 — malformed id, invalid enum/date,
pagination out of range), `TALLY_API_KEY_INVALID` (401), `AUTHORIZATION_ERROR` (403 — valid key, missing
scope), `NOT_FOUND` (404), `TALLY_SYNC_IN_PROGRESS` / `TALLY_RETRY_LIMIT_EXCEEDED` (409, from the sync
endpoint), `RATE_LIMIT_EXCEEDED` (429). Production responses never include a stack trace, file path,
database connection string, or the key's hash.

The sync endpoint's underlying Tally call can also fail with one of the normalized codes below (surfaced
as the `errorCode` on the sync status, not as a different HTTP status — a rejected voucher is still a
"successful API call that reports a failed sync," per the existing Phase 6 contract):
`TALLY_CONNECTION_FAILED`/`TALLY_UNREACHABLE`, `TALLY_TIMEOUT`, `TALLY_MALFORMED_RESPONSE`,
`TALLY_REJECTED` (generic voucher rejection), `TALLY_COMPANY_NOT_FOUND` and `TALLY_DUPLICATE_VOUCHER`
(Phase 14 — inferred from Tally's free-text rejection message, since Tally's protocol has no structured
error code; falls back to `TALLY_REJECTED` when the message doesn't match a known pattern — this is
best-effort classification, not a guarantee, and has not been verified against a real TallyPrime instance).

## Rate limits

The public API has its own rate-limit bucket (`tallyPublicApi` — see `backend/src/config/rateLimits.js`),
keyed by the presented API key so one tenant's integration traffic cannot exhaust another tenant's
budget, with IP as a secondary bucket for requests that omit the header. Default: 120 requests/minute per
key. This is independent of, and in addition to, the general per-IP ERP rate limit. `RATE_LIMIT_DISABLED`
cannot be set to `true` in a production environment (enforced at startup — see
`docs/deployment/environment-variables.md`).

## Retry behavior

For `GET` endpoints: safe to retry on `5xx` or a network error; a `429` response should back off (the
`RateLimit-*` headers follow the IETF draft-7 standard and indicate when the window resets). For
`POST /invoices/:id/sync`: safe to retry — the endpoint is idempotent by design (see above); retrying a
request that already resulted in `SYNCED` simply returns the same `SYNCED` status with no duplicate
Tally call.

## Idempotency

The sync endpoint's idempotency is enforced at the data layer (one sync record per
`(tenant, invoice)`, status-guarded so two concurrent calls cannot both proceed), not via a client-supplied
`Idempotency-Key` header — there is nothing for a client-supplied key to add here, since the invoice id
itself is already the natural idempotency key for "sync this invoice." The read endpoints are side-effect
free and need no idempotency mechanism.

## Security rules (summary)

- Tenant is **always** resolved from the API key record, never from the request.
- A request's scopes come from the key record; nothing in the request body/query can grant a scope the
  key doesn't have.
- The raw key is shown only at creation/rotation; it is hashed (keyed HMAC, not reversible encryption —
  same non-reversible pattern used for refresh tokens) before being stored, so a database compromise alone
  cannot yield a usable key.
- Every authentication failure and scope denial is audited (`TALLY_API_KEY_AUTH_FAILED`,
  `TALLY_API_SCOPE_DENIED`) without ever recording the raw key.
- This API has no endpoint that creates, edits, issues, or cancels anything other than triggering an
  already-configured Tally sync. It cannot modify Tally configuration, access another tenant's data, or
  reach any platform-level/cross-tenant report.

## What this API will never do

Per the ERP's scope boundaries (see `docs/gst-workflow.md`): no GSTN/government filing integration, no
automatic e-filing, no generated/fabricated GST acknowledgement or ARN. This API is strictly the
Tally ↔ ERP data boundary described above.
