# Tally integration (Phase 6)

**Status: IMPLEMENTED against the ERP's own data model and a mock HTTP/XML test server used in the test
suite. No real TallyPrime instance was available in this environment — live connectivity is NOT
AVAILABLE and has not been verified against actual Tally software.**

```
Invoice (frozen snapshot) -> TallySyncService (use-cases, idempotency, retries, audit)
   -> TallyAdapter (port: testConnection / syncInvoice / healthCheck)
      -> TallyMapper (invoice snapshot -> plain voucher data; NO live Customer/Product/BusinessProfile reads, NO GST recompute)
      -> buildVoucherRequestXml (tally.payloadBuilder.js; xmlbuilder2 — no raw string concatenation)
      -> TallyClient (axios HTTP POST; SSRF guard, timeout, response-size cap; fast-xml-parser response parsing)
   -> normalized {success, voucherId?, voucherNumber?, errorCode?, message?}
-> TallySync record (idempotency key) + audit log
```

Invoices never call Tally directly: `invoice.service.js` exposes exactly one integration-facing method,
`getIssuedInvoiceForTally(ctx, id)`, which returns the authoritative ISSUED invoice (snapshots + computed
totals) or throws `TALLY_INVOICE_NOT_ISSUED`. All XML/HTTP/mapping logic lives under
`backend/src/integrations/tally/`.

## Connection config

One `TallyIntegration` document per tenant (`tenantId` unique index). `connectionType` is
`LOCAL_TALLY`/`REMOTE_TALLY` — both resolve to the same thing operationally: **a network-accessible
HTTP/XML endpoint the ERP server itself can reach** (`baseUrl`). The ERP server runs on its own host (or
container) and cannot reach a literal `localhost` that only means something on a customer's desktop
browser; "LOCAL_TALLY" documents that, from the customer's point of view, Tally Prime runs on a machine on
their own LAN that the ERP server is routed to reach (e.g. via VPN, port-forward, or the ERP being
self-hosted on the same network).

Ledger mapping (`salesLedger`, `cgstLedger`, `sgstLedger`, `igstLedger`, `roundOffLedger`) is tenant-specific
and stored on the config — never hardcoded in mapper/payload code. `timeoutMs` is clamped to
[1000, 60000] (tally.ssrf.js `clampTimeout`) — it can never be 0/infinite. `retryPolicy.maxAttempts`
defaults to 3.

**Secrets**: `authPasswordEncrypted` reuses the existing `EncryptionService` (AES-256-GCM,
`backend/src/security/encryption.js`) and is `select:false` on the schema (excluded from default
projections/queries). `serialize()` (`utils/serialize.js`) also strips any field named
`credentialsEncrypted`/`authPasswordEncrypted` from every API response as defence in depth. The config API
never returns the raw secret — only a derived `hasPassword: true/false`. The frontend settings page never
round-trips the password as plaintext: the password field is blank/placeholder on load and is only sent in
a save request when the admin actually types a new value.

## Provider abstraction

`TallyAdapter` is the single port the rest of the app depends on: `testConnection()`, `syncInvoice()`,
`healthCheck()`. **`getCompanies()` is intentionally NOT implemented** — TallyPrime's XML-over-HTTP
interface does not expose a generic "list companies" call without a locally-installed connector/agent
(explicitly out of scope for this phase), so company selection is a manually-typed `companyName` field in
config instead.

## SSRF / network security

See `backend/src/integrations/tally/tally.ssrf.js` for the implementation and its inline reasoning. Summary:

- **Protocol allowlist**: only `http:`/`https:` are accepted; `file://`, `gopher://`, etc. are rejected.
- **Metadata-address block (unconditional)**: `169.254.169.254` (and the IPv6 equivalents `fd00:ec2::254`,
  `fe80::/10`) are rejected outright, whether given as a literal IP or resolved via DNS.
- **Private/LAN addresses are explicitly ALLOWED** (`127.0.0.1`, `10.x`, `172.16-31.x`, `192.168.x`,
  `localhost`). This is the realistic, legitimate on-prem-Tally case for a self-hosted ERP: a
  `CLIENT_ADMIN` configures a URL for **their own tenant's** internal server, which is a fundamentally
  different trust boundary than a public SaaS fetching an arbitrary end-user-supplied URL. Blanket-banning
  RFC1918 would make the feature useless for its primary use case.
- **Timeout**: always finite, clamped to [1s, 60s].
- **Response size cap**: 2 MB (`axios` `maxContentLength`/`maxBodyLength` plus a post-hoc byte-length
  check), preventing memory exhaustion from a malicious or misbehaving endpoint.
- **Residual risk** (accepted): a compromised/malicious tenant admin could still point the integration at
  another internal service reachable from the ERP host (SSRF against same-host-reachable infrastructure).
  This is accepted because that admin already holds tenant-wide configuration rights — the same trust
  level as, e.g., a webhook URL — and it is not a cross-tenant or cross-customer exposure; MASTER_ADMIN
  configuration changes remain impossible without the explicit, audited `X-Admin-Tenant-Id` header
  mechanism already used throughout the platform.

## XML safety

All request XML is built with `xmlbuilder2` (`tally.payloadBuilder.js`) — never raw string concatenation —
so values that happen to contain `<`, `&`, `"`, etc. (e.g. a customer name with an ampersand) are escaped
correctly instead of corrupting the document or enabling XML injection. Responses are parsed with
`fast-xml-parser` and normalized into `{success, voucherId?, voucherNumber?, errorCode?, message?}`; no raw
parser/network error text is ever returned to a caller.

## Invoice eligibility & sync lifecycle

Only **ISSUED** invoices are sync-eligible. `getIssuedInvoiceForTally` rejects DRAFT with
`TALLY_INVOICE_NOT_ISSUED` (409). A **CANCELLED** invoice that was already `SYNCED` before cancellation is
**not** auto-reversed/un-synced — the sync-status endpoint keeps reporting `SYNCED` idempotently.
Reversal/adjustment-voucher handling on cancellation is an explicit **future enhancement**, not implemented
here. A CANCELLED invoice that was never synced stays ineligible (same `TALLY_INVOICE_NOT_ISSUED` rejection
as DRAFT).

`TallySync` status set (reuses the existing `TALLY_SYNC_STATUS` enum from `constants/statuses.js`):
`NOT_SYNCED -> (QUEUED/SYNCING) -> SYNCED | FAILED -> RETRYING -> SYNCED|FAILED`. `QUEUED` is this
feature's "PENDING" (a record exists, not yet attempted) — most requests move QUEUED->SYNCING->terminal in
one call, so a lingering QUEUED row is only ever visible if a process crashed mid-attempt.

## Idempotency

One `TallySync` document per **(tenantId, invoiceId)** — the **unique index on (tenantId, invoiceId) is
the idempotency key**, not a separately invented request-id field (a tenant has exactly one
`TallyIntegration`, so `(tenantId, invoiceId)` already uniquely identifies "this invoice synced against
this tenant's configured integration"; `integrationId` is still stored for forward-compatibility with a
possible future multi-integration design).

`POST /invoices/:id/tally-sync`:
- `SYNCED` already recorded -> returns the existing record immediately, **no new Tally call**.
- `SYNCING` -> `409 TALLY_SYNC_IN_PROGRESS` (another request is in flight).
- `FAILED`/`RETRYING` -> retried via an atomic, status-guarded `findOneAndUpdate` (the exact
  `conditionalUpdate` pattern `InvoiceRepository` already uses for issue/cancel races), up to
  `retryPolicy.maxAttempts`.
- Otherwise: an atomic `create` claims the very first `SYNCING` row; if two concurrent requests race, the
  unique index rejects the loser's insert (`E11000`), and the loser simply re-reads the winner's state.

## API

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/tally/config` | `tally.view` | Masked (no secrets) |
| POST | `/api/v1/tally/config` | `tally.configure` | Create/update; password only applied if supplied |
| POST | `/api/v1/tally/test-connection` | `tally.configure` | Updates `lastConnectedAt`/`lastConnectionStatus` |
| POST | `/api/v1/invoices/:id/tally-sync` | `tally.sync` | Idempotent |
| GET | `/api/v1/invoices/:id/tally-sync` | `tally.view` | No secrets |

## RBAC

- `tally.configure`: CLIENT_ADMIN by default; grantable to CLIENT_USER via per-user grants (same grant
  mechanism as every other permission).
- `tally.sync`: CLIENT_ADMIN by default; grantable to CLIENT_USER.
- `tally.view`: both CLIENT_ADMIN and CLIENT_USER by default (read-only).
- `GST_VENDOR`: no Tally routes at all — this follows the same vendor boundary used elsewhere (vendors
  only reach aggregate, explicitly-assignment-gated views such as `/vendors/me/clients/:tenantId/invoices`,
  never a per-invoice action route) rather than inventing a new vendor capability.
- `MASTER_ADMIN`: no default Tally permissions; any tenant-scoped access still requires the existing,
  audited `X-Admin-Tenant-Id` mechanism (`resolveTenant` in `middlewares/access.js`) — there is no blanket
  cross-tenant visibility.

## Audit events

`TALLY_INTEGRATION_CREATED`, `TALLY_INTEGRATION_UPDATED`, `TALLY_CONNECTION_TESTED`,
`TALLY_SYNC_STARTED`, `TALLY_SYNC_SUCCEEDED`, `TALLY_SYNC_FAILED`, `TALLY_SYNC_RETRIED`. Credentials are
never included in audit metadata (only a derived `baseUrlHost`, never the full URL or password).

## Explicitly out of scope (Phase 6)

GST filing / GSTR-1 / GSTR-3B / government portal integration, a desktop connector/agent, payment gateways,
and automatic generic company discovery (`getCompanies()`), per the Phase 6 brief.

## Phase 14 — external integration compatibility pass

Phase 14 audited this entire implementation against real-world external-integration requirements and made
targeted additions rather than a rewrite — the adapter boundary (`TallyAdapter` → `TallyMapper` →
`tally.payloadBuilder.js` → `TallyClient`), SSRF policy, and XML safety described above were already in
the shape this kind of audit asks for and were left unchanged.

- **Company mapping**: already tenant-scoped and already configurable — `TallyIntegration.companyName`
  (used verbatim in `SVCURRENTCOMPANY`/the connection-test ping) and `TallyIntegration.companyGuid`
  (stored for forward-compatibility; no current code path reads it, since TallyPrime's XML-over-HTTP
  interface addresses a company by name, not GUID, and inventing a GUID the admin can't actually obtain
  would be worse than not having one). No new field was needed: a Business Admin already types the exact
  Tally company name into the existing Tally settings page, independent of the ERP tenant's own name.
- **Error classification**: two new normalized codes, `TALLY_COMPANY_NOT_FOUND` and
  `TALLY_DUPLICATE_VOUCHER` (`tally.constants.js`), inferred in `tally.client.js#classifyRejection` from
  Tally's free-text `MESSAGE` field (Tally's XML protocol has no structured error-code field — this is
  best-effort pattern matching, not a guarantee, and falls back to the existing generic `TALLY_REJECTED`
  when the message doesn't match). Verified in `tests/api/tally.api.test.js`'s existing rejection-handling
  test (unaffected — its mock message, "Ledger does not exist," correctly still falls back to generic
  `TALLY_REJECTED`).
- **XML escaping test coverage**: `tests/unit/tally.xml.test.js` (new) exercises `&`, `"`, `'`, `<`, `>`,
  CDATA-close and closing-tag injection attempts, and Kannada/Hindi Unicode text through
  `buildVoucherRequestXml`, asserting the output is well-formed XML (via `fast-xml-parser`'s
  `XMLValidator`) and that injected markup never appears as a sibling element — confirming `xmlbuilder2`'s
  escaping genuinely defeats XML injection rather than merely being assumed to.
- **Secret/log hygiene confirmed (no code change needed)**: `middlewares/httpLogger.js` logs only
  method/path/status/duration/userId/tenantId — it never serializes request headers at all, so
  `X-Tally-API-Key` structurally cannot reach a log line. `utils/sanitize.js#redactSecrets` additionally
  strips any audit-metadata key matching `/api[-_]?key/i` as defence in depth. Verified directly in
  `tests/api/tallyPublicApi.test.js`.
- **API-key rotation race**: verified under genuine concurrency (a rotate call racing a request
  authenticated with the pre-rotation key) that the old key is unconditionally dead and the new key works
  immediately afterward, with no window where both are valid — the atomic `findOneAndUpdate` in
  `TallyApiKeyService.rotate()` (Phase 13, unchanged) already guaranteed this; Phase 14 added the explicit
  test.
- **Response format decision**: the Tally Public API (`docs/api/tally-public-api.md`) remains JSON-only.
  XML was deliberately NOT added to the public-facing read/sync API — Tally's XML protocol is the
  ERP's *outbound* wire format to Tally (above), not a requirement on an external script/connector calling
  *into* the ERP, for which JSON is simpler. This is documented as a decision, not an oversight.

See `docs/api/tally-public-api.md` and `docs/integrations/tally-integration-handoff.md` for the Phase 13
public API this phase hardened, and the "Real TallyPrime/TDL testing status" note in this phase's final
report — no real TallyPrime instance has been used to validate any of the above.

## Phase 16 update: Tally Connector Bridge

This Phase 6 direct ERP→Tally path (above) is unchanged. Phase 16 adds a **separate** bridge for the
client/shop bill-intake workflow (Phase 15's `BillIntake` + Tally Queue), via a Windows Tally Connector
rather than a direct server-to-server call — see `docs/integrations/tally-connector.md` for the full
architecture, security model, and real-Tally-testing checklist. In short:

- A new, independent credential type (`TallyConnector`, its own keyed-HMAC-hashed secret) authenticates the
  connector — distinct from the Tally Public API key described above and from the ERP user JWT.
- A new `TallyJob` queue (`SYNC_BILL_TO_TALLY` job type) bridges a `READY_FOR_TALLY` `BillIntake` to the
  connector; the connector polls, claims, submits to local TallyPrime, and reports back.
- The connector reuses this file's same XML-over-HTTP protocol (`ENVELOPE/IMPORTDATA` →
  `ENVELOPE/IMPORTRESULT`) rather than inventing a new one, but ships its own minimal, dependency-free
  implementation (`connector/src/tally/tallyClient.js`) so the connector can run with zero npm
  dependencies.
- **Real TallyPrime/TDL integration testing was not performed** for Phase 16 either — validated only via
  the connector's `TALLY_MODE=mock` adapter and the ERP's existing mock Tally test infrastructure.
