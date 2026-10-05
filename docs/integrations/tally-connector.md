# Tally Connector Bridge (Phase 16)

> **Status: real TallyPrime/TDL integration testing was NOT performed.** Everything described here was
> validated using the ERP's existing mock Tally infrastructure (a local HTTP server standing in for
> TallyPrime) and the connector's own `TALLY_MODE=mock` adapter. See section 16 for the exact checklist a
> real TallyPrime environment still needs to complete before this can be called production-proven.

## 1. Architecture

```
CLOUD ERP (Express monolith, unchanged)             WINDOWS CONNECTOR (separate Node.js process)        TALLY PRIME
┌───────────────────────────────┐    HTTPS, outbound  ┌─────────────────────────────┐   local HTTP/XML   ┌───────────┐
│ /api/v1/tally/connector/*     │◄────── poll/claim ──┤ src/jobs/runner.js          │────── voucher ─────►│ (client's │
│ TallyConnectorService         │────── job payload ──►│ src/tally/localTallyAdapter │◄───── result ───────┤  company) │
│ TallyJobService               │◄───── result ────────┤ src/tally/tallyClient.js    │                     └───────────┘
│ BillIntakeService (Phase 15)  │                      │ src/api/erpClient.js        │
└───────────────────────────────┘                      └─────────────────────────────┘
```

Two sides, as specified:

- **Side A (cloud ERP, `backend/src/...`)**: owns connector registration, authentication, tenant binding,
  job creation, job claiming/delivery, job status, retry, heartbeat, audit, monitoring. The ERP remains the
  single source of truth for every bill and job state transition.
- **Side B (Windows connector, `connector/`)**: a standalone Node.js project. Authenticates to the ERP,
  polls for jobs, claims one, talks to local TallyPrime, parses the response, reports the result, retries
  its own transient failures safely, and sends a heartbeat. It contains **no ERP business logic** — it
  never decides whether a bill is "ready," never computes GST, never invents a retry policy; it only
  executes exactly the `SYNC_BILL_TO_TALLY` job type against a payload the ERP already built.

The ERP backend was **not** split into microservices — it stays the same modular monolith as Phases 1-15.
The connector is an entirely separate runtime artifact (own `package.json`, own tests, own lint/build),
analogous to how a repo might ship a CLI alongside a server, not a service-mesh component of the ERP.

## 2. Why TallyPrime is not publicly exposed

TallyPrime's XML-over-HTTP gateway has no authentication of its own beyond IP/firewall rules and is meant
for LAN-local tools. Exposing it to the internet would let anyone who finds the port create/alter vouchers
in the client's real accounting data. Instead, the connector **initiates** every connection: outbound to the
ERP (poll/claim/report) and outbound to `localhost`/LAN TallyPrime. Nothing ever connects *into* the
client's or vendor's machine from the ERP or from the internet.

## 3. Connector installation concept

The connector is a plain Node.js (≥18) project with **zero external dependencies** (uses only Node's
built-in `fetch`/`http`), so it can be copied to a Windows machine and run with `npm start` (or packaged
with a tool like `pkg`/`nexe` into a single `.exe` in a later phase — not built here, out of scope). See
`connector/README.md` and `connector/.env.example` for the full configuration surface: ERP base URL,
connector secret, polling interval, local Tally host/port, company name, timeouts, retry, logging — all
env-driven, nothing hard-coded (spec Step 32).

## 4. Connector registration

An ERP admin (Master Admin for any tenant, or a tenant's own Client Admin for their tenant) registers a
connector from the Tally Settings area:

```
POST /api/v1/tally/connectors   { "name": "Warehouse PC" }
-> { id, name, connectorSecret: "tconn_live_...", status: "ACTIVE", scopes: [...] }
```

The raw `connectorSecret` is returned **exactly once**, at creation (and again, once, on rotation) — it is
never stored in plaintext, never returned again from `GET`/list, and the field name is deliberately
`connectorSecret` rather than `secret` so the ERP's blanket secret-redaction layer (`utils/serialize.js`)
still strips any field *actually* named `secret` everywhere else, while this one intentional exception is
visible and auditable at the one call site that needs it.

Revoke (`POST /:id/revoke`) and rotate (`POST /:id/rotate`) are immediate — a revoked/rotated-away secret
fails auth on the very next request, with no grace window.

## 5. Authentication

A connector credential is a **third, independent authentication system**, alongside:

1. the human ERP JWT (`middlewares/access.js`),
2. the Tally Public API key, Tally→ERP direction (`middlewares/tallyApiAuth.js`, Phase 13),
3. **the connector secret** (`middlewares/tallyConnectorAuth.js`, this phase).

None of the three is ever accepted in place of another. The connector sends its secret in the
`X-Tally-Connector-Secret` header on every request; the ERP looks it up by a keyed-HMAC hash (same
non-reversible primitive as the Tally Public API key and the refresh-token hash — `security/apiKey.js`),
never by the plaintext value, and never logs the header (verified in
`tests/api/tallyConnector.test.js`'s "LOGGING" case and in `connector/tests/jobRunner.test.js`'s "never
sends the connector secret in the request body" case).

Missing, malformed, unknown, revoked and inactive secrets all return the same generic
`401 TALLY_CONNECTOR_INVALID` — a prober cannot distinguish "wrong secret" from "revoked secret" from "no
header at all."

## 6. Tenant binding

The connector's tenant is **always** resolved from the authenticated secret record — never from any
request body/query/URL field. Every downstream repository call is scoped off that resolved tenant id
(`TenantRepository#scope`), so even a request that tries to pass `?tenantId=<other tenant>` on
`GET /jobs` is silently ignored; the response still only contains the authenticated connector's own
tenant's jobs (tested explicitly). Claiming or reporting a result on a job id that belongs to another
tenant returns a 404/409, never the other tenant's data.

## 7. Company binding

Each `TallyConnector` record stores `tallyCompanyName`/`tallyCompanyGuid`, copied from the tenant's
`TallyIntegration` record **at registration time** — never fabricated. Before a job payload is ever handed
to a connector, `TallyJobService.claim()` re-verifies that the connector's stored company name still
matches the tenant's *current* `TallyIntegration.companyName`. If they don't match (e.g. the integration
was reconfigured, or a connector was registered before the integration existed), the claim fails safely
with `409 TALLY_COMPANY_BINDING_UNVERIFIED` and the job is marked `FAILED` with
`TALLY_MAPPING_MISSING` — the connector is never handed a payload for an unverified company.

## 8. Polling

`GET /api/v1/tally/connector/jobs` returns only jobs that are: in the connector's own tenant, `QUEUED`, and
due (`availableAt <= now`, which is how retry backoff works without a separate scheduler). The connector
polls on a plain interval (`POLL_INTERVAL_MS`, default 10s) rather than being polled — the ERP never
initiates a connection to the connector.

## 9. Job lifecycle

```
QUEUED --(claim, atomic)--> CLAIMED --(claim success)--> PROCESSING --(result SUCCEEDED)--> SUCCEEDED
                                                              \--(result FAILED)--> FAILED --(retry)--> QUEUED
```

`SUCCEEDED` is terminal — there is no reversal path (`TallyJobRepository#succeed`/`#fail` both require
`status: 'PROCESSING'` in their filter, so a second `result` call after `SUCCEEDED` always 409s).

Only one job type exists: `SYNC_BILL_TO_TALLY`. A `TallyJob` is created exactly once per bill, the moment
`BillIntakeService#review()` moves a bill to `READY_FOR_TALLY`/`tallyStatus QUEUED` — via an injected hook
(`tallyJobHook`), so Phase 15's `BillIntakeService` has no import-time dependency on this phase.

## 10. Retry

A `FAILED` result is only auto-retried (back to `QUEUED`, with exponential backoff — 30s/60s/300s/900s/1h)
when the reported `errorCode` is one of the transient codes (`TALLY_UNREACHABLE`, `TALLY_TIMEOUT`,
`TALLY_SYNC_IN_PROGRESS`), and only up to `TALLY_JOB_RETRY_POLICY.maxAttempts` (5). Permanent-looking
errors (`TALLY_REJECTED`, `TALLY_COMPANY_NOT_FOUND`, `TALLY_DUPLICATE_VOUCHER`) are left `FAILED` — an
admin/vendor can still manually retry a bill via the existing Phase 15 `POST /bills/:id/tally/retry` path,
which re-queues the bill and (through the same `tallyJobHook`) can create a fresh job.

## 11. Idempotency

Two layers:

1. **Job creation**: the `(tenantId, billIntakeId, type)` unique index on `TallyJob` IS the idempotency
   key. A duplicate creation attempt (double review, retried request, concurrent approvals) hits a Mongo
   `E11000`, which `TallyJobService#createForBill` catches and treats as "already exists" — never a second
   row, never an error surfaced to the caller.
2. **Claim/result**: both are atomic conditional updates keyed on the job's *current* status — a second
   claim attempt on an already-`CLAIMED`/`PROCESSING` job, or a second result report on an already-resolved
   job, always fails safely (409) rather than corrupting state or double-crediting a Tally sync.

A connector restart mid-job is safe: on restart it simply polls again; if its claim is still recorded
(`CLAIMED`/`PROCESSING`, `connectorId` = itself) nothing else can have claimed it, and if it crashed before
claiming, the job is still `QUEUED` for the next poll.

## 12. Heartbeat

`POST /api/v1/tally/connector/heartbeat { version, tallyAvailable }` updates `lastHeartbeatAt` and
(throttled — see below) `version`/`lastTallyAvailable`. `lastPollAt` is updated on every `GET /jobs` call
(a poll always counts as "the connector is alive" even if there happened to be no jobs). `lastSuccessfulSyncAt`
is updated whenever a job is reported `SUCCEEDED`.

Heartbeat *persistence* is throttled to once per 15 seconds per connector (`HEARTBEAT_THROTTLE_MS`) even if
the connector heartbeats more often, so a fast heartbeat interval cannot turn into a write-storm on the
`TallyConnector` collection.

## 13. Offline behavior

If a connector stops heartbeating, its jobs are left exactly where they are (`QUEUED` stays `QUEUED`) —
nothing marks them `FAILED` merely because the connector disappeared. `TallyConnectorService#isOffline()`
is a read-only projection (`now - lastHeartbeatAt > threshold`) the admin UI/queue view can use to show
"Connector Offline" + a count of pending jobs for that connector's tenant. When the connector reconnects
and polls again, it simply picks up whatever is `QUEUED` and due — no special "resume" step is needed
because nothing was ever paused at the data level.

A scheduled sweep (`TallyConnectorService#sweepOfflineConnectors`) additionally flips a connector's stored
`status` from `ACTIVE` to `INACTIVE` (and records `offlineSince`) once it has been silent for longer than
`TALLY_CONNECTOR_OFFLINE_AFTER_SECONDS` (default 120s), running every `TALLY_CONNECTOR_MONITOR_INTERVAL_SECONDS`
(default 60s) via a single `setInterval` in the main process — this assumes a single backend instance; a
multi-instance deployment would need a leader-election or cron-based mechanism instead, which is out of
scope here. A heartbeat from a connector the monitor marked `INACTIVE` automatically recovers it to `ACTIVE`.
See section 19 for how this is now surfaced in the admin UI.

## 14. Tally communication

The connector's `LocalTallyAdapter` + `TallyClient` (`connector/src/tally/`) use the **same XML-over-HTTP
mechanism** TallyPrime's gateway exposes that the backend's existing `tally.client.js` already uses for the
direct ERP→Tally sync path (Phase 6) — an `ENVELOPE/IMPORTDATA` POST, an `ENVELOPE/IMPORTRESULT` response.
No second protocol was invented. The connector's copy is a minimal, dependency-free reimplementation (Node's
built-in `http`, a small regex-based tag extractor instead of a full XML parser) so the connector can ship
with zero npm dependencies; it is **not** a general-purpose XML parser and is not used for anything beyond
reading the fixed `CREATED`/`ERRORS`/`LASTVCHID`/`LASTVCHNO`/`MESSAGE` tags TallyPrime's `IMPORTRESULT`
documents.

**Bill → Tally mapping gap (spec Step 13 — read this before treating Phase 16 as "complete" for real
money)**: Phase 15 deliberately never auto-converts a `BillIntake` into an official ERP `Invoice`. The
existing `TallyMapper.mapInvoice()`/`buildVoucherRequestXml()` path (Phase 6) requires a fully mapped
Invoice — per-line HSN/quantity/rate, resolved customer/product ledger names, GST computed and frozen by
`InvoiceCalculationService`. A `BillIntake` has none of that; it is a single vendor-entered total. Rather
than inventing line-item/ledger-mapping logic to force a `BillIntake` through the Invoice-shaped mapper
(which the spec explicitly prohibits as "fabricated accounting logic"), this phase stops at a documented,
honest boundary:

- `buildBillJobPayload()` (`backend/src/integrations/tally/tally.payloadBuilder.js`) builds ONLY the bounded
  queue/job payload (bill number/date, vendor name/GSTIN, amount, taxable amount, CGST/SGST/IGST — all
  already-stored, never recomputed) — not Tally XML.
  **This is genuinely new, additive code** in `tally.payloadBuilder.js`, separate from `buildVoucherRequestXml`.
- The connector's `LocalTallyAdapter.buildVoucherXml()` turns that payload into a **minimal, fixed-template
  "Purchase" voucher** (single ledger line at the bill's total amount, no GST ledger split, no HSN/line
  items) — adequate to prove the pipeline end-to-end, but **not** a substitute for a real
  accounts-payable/purchase-ledger mapping a GST/accounting vendor would need for a production bill entry.
- **What a real implementation still needs** before this can safely post production bill data into a
  client's real Tally books: (a) a configured purchase-ledger / GST ledger mapping for `BillIntake` data
  (mirroring what `TallyIntegration.salesLedger/cgstLedger/...` already does for invoices), and (b) a
  decision on whether multi-line bills (multiple expense categories on one vendor bill) need to be
  represented at all — `BillIntake` currently has no line-item model. Both are explicitly **not built** in
  this phase; building them without a deliberate product/accounting decision would be exactly the kind of
  speculative accounting logic the spec says not to invent.

## 15. Security

- Connector secret: 256-bit random, `tconn_live_` prefixed, keyed-HMAC hashed at rest, shown once, never
  logged (verified by both the backend's and the connector's own tests).
- Tenant isolation / IDOR: every connector-facing query is scoped off the authenticated connector's
  resolved tenant; cross-tenant claim/result/job-id guessing is rejected (`tests/api/tallyConnector.test.js`
  "TENANT ISOLATION").
- Scope enforcement: a connector only ever has the three minimal scopes
  (`tally:connector:poll|submit|heartbeat`) — never a human permission.
- Mass assignment: `tallyJobResultBody` is a `.strict()` Zod schema accepting only
  `status|tallyReference|errorCode|message|requestId`; an unknown field or an unsupported `status` value is
  rejected at validation, before the service layer ever sees it.
- XML injection: the connector's voucher XML builder manually escapes `&<>"` (tested); the ERP never sends
  the connector XML to execute — only JSON bill data.
- SSRF: the connector only ever talks to its own configured `ERP_BASE_URL` and `TALLY_HOST`/`TALLY_PORT` —
  both operator-configured, never derived from any server response.
- No arbitrary command execution: the connector has exactly one job type it can execute
  (`SYNC_BILL_TO_TALLY`), built from a fixed template; the cloud never sends raw XML or a shell command to
  run.
- Rate limiting: `tallyConnector` is its own limiter group, keyed by the presented secret prefix, so one
  connector cannot exhaust another connector's or the platform's general budget.
- Audit: `TALLY_CONNECTOR_CREATED/REVOKED/ROTATED/AUTH_FAILED/HEARTBEAT`,
  `TALLY_JOB_CREATED/CLAIMED/CLAIM_CONFLICT/SUCCEEDED/FAILED/RETRIED` — no secret values in any audit
  metadata.

## 16. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 TALLY_CONNECTOR_INVALID` on every call | Secret revoked/rotated, or `.env` has a stray space/newline |
| `409 TALLY_COMPANY_BINDING_UNVERIFIED` on claim | Tenant's `TallyIntegration.companyName` doesn't match the connector's registered company — re-register the connector after confirming Tally config |
| Jobs never appear in `GET /jobs` | Bill hasn't reached `READY_FOR_TALLY`, or connector is polling the wrong tenant's secret |
| Admin UI shows "Connector Offline" | No heartbeat within the threshold — check the connector process is running and `ERP_BASE_URL` is reachable |
| `TALLY_UNREACHABLE` on every job | `TALLY_HOST`/`TALLY_PORT` wrong, or TallyPrime's HTTP gateway isn't enabled (Gateway of Tally → F12 → Advanced Configuration) |

## 17. Real Tally setup requirements (for the first real test)

This environment has no TallyPrime installation, so none of the following has been verified against a real
instance:

1. Install TallyPrime on a Windows machine; enable its HTTP/XML gateway (F12 → Advanced Configuration →
   "Allow import/export of data" + enable the local HTTP server, default port 9000) and load the client's
   company.
2. Confirm the ledgers a real bill needs exist in that company (a purchase/expense ledger and whatever
   GST ledgers apply) — **not currently configurable for BillIntake** (see section 14's mapping gap); a
   minimal manual test can use `TALLY_MODE=http` with the fixed single-ledger voucher template as-is, but a
   production rollout needs the ledger-mapping work called out above first.
3. Set the connector's `.env`: `TALLY_MODE=http`, `TALLY_HOST`/`TALLY_PORT` to the Tally machine, and
   `TALLY_COMPANY_NAME` to the exact company name as it appears in TallyPrime (must match
   `TallyIntegration.companyName` for company binding to pass, section 7).
4. Register a connector from the ERP admin UI for the target tenant, put its `connectorSecret` into the
   connector's `.env`, and start the connector.
5. Create and approve one real test bill through to `READY_FOR_TALLY` and watch the connector's logs for
   the claim/submit/result cycle; confirm the voucher actually appears in TallyPrime; confirm the ERP side
   (`GET /api/v1/tally/connectors/:id` and the bill's `tallyStatus`) reflects `SYNCED` with a real
   `tallyReference`.
6. Only after that succeeds should `TALLY_MODE=http` be considered validated — update this document's
   status banner once it has been.

## 18. External integration test checklist

- [ ] Connector registered against a real tenant with a configured `TallyIntegration`
- [ ] `TALLY_MODE=http` reaches a real local TallyPrime instance (not mock)
- [ ] A real bill reaches `READY_FOR_TALLY` and the resulting job is claimed within one poll interval
- [ ] The generated voucher XML is accepted by TallyPrime and a real voucher appears in the company
- [ ] `tallyReference` recorded on the ERP side matches the voucher number in TallyPrime
- [ ] A deliberately malformed/unreachable TallyPrime (wrong port) produces `TALLY_UNREACHABLE` and a
      bounded retry, not a crash or an infinite loop
- [ ] Revoking the connector mid-run stops it from claiming new jobs on its next poll
- [ ] Heartbeat/offline detection observed in the admin UI when the connector process is killed

## 19. Admin UI (Phase 16.1)

A Master Admin / Client Admin (whoever holds `tally.connector.view`/`tally.connector.manage`) now manages
connectors and monitors the job queue directly in the ERP UI instead of via raw API calls. This section
only describes the UI; the backend behavior it surfaces (offline detection, heartbeat, job lifecycle) is
unchanged and already covered above.

- **Connector list** (`/master/tally-connectors`, `/client/tally-connectors`) — `frontend/src/features/tally/ConnectorListPage.jsx`.
  Shows name, status, version, Tally company, last heartbeat, created/updated. The backend only ever stores
  `ACTIVE`/`INACTIVE`/`REVOKED` (`TALLY_CONNECTOR_STATUS`); the page derives a friendlier display label
  client-side only (`connectorsApi.js#deriveConnectorDisplayStatus`) — `Online` (ACTIVE + has heartbeated),
  `Never connected` (ACTIVE, no heartbeat yet), `Offline` (INACTIVE — i.e. the section 13 monitor sweep
  fired), `Revoked`. No new backend status was introduced for this.
- **Register / Rotate** — the raw connector secret returned by `POST /tally/connectors` or
  `POST /tally/connectors/:id/rotate` is shown exactly once, with a copy button and an explicit "cannot be
  retrieved again" warning, and is held only in React component state — never written to
  `localStorage`/`sessionStorage`/the URL, and unrecoverable once the reveal panel is dismissed.
- **Revoke** — requires a confirm dialog; on confirm the UI immediately reflects the revoked state via a
  reload of the list/detail data (no optimistic client-side mutation).
- **Connector detail** (`/master/tally-connectors/:id`) — `ConnectorDetailPage.jsx` — adds scopes, last poll,
  last successful sync, last Tally-available flag, and last error code/message for diagnosing a specific
  connector.
- **Job queue** (`/master/tally-queue`, `/vendor/tally-queue`) — `frontend/src/features/bills/TallyQueuePage.jsx`,
  backed by the existing `GET /tally/queue` endpoint (server-side paginated, filterable by `tallyStatus`).
  There is currently no separate admin-facing listing of raw `TallyJob` documents (connector id, attempts,
  claimed/started timestamps) — only this bill-level queue view, which is what the endpoint actually
  returns. See "Known limitations" below. A "Retry" action on a `FAILED` row is wired to the existing manual
  retry endpoint (`POST /bills/:id/tally/retry`) behind a confirmation dialog — it never mutates status
  client-side.
- **Permission gating is UX only** — every one of the above actions is re-checked by the backend
  (`tally.connector.view`/`tally.connector.manage`, `tally_queue.view`, `bills.tally_manage`); hiding a
  button in the UI for a user lacking the permission is a convenience, not the actual security boundary.

**Known limitation:** the `TallyJob` collection (connector id, attempts, claimed/started/completed
timestamps per job) has no dedicated admin-facing list endpoint yet — only the connector-authenticated
`GET /tally/connector/jobs` (claimable jobs for that connector) and the bill-level `GET /tally/queue` exist.
Building a true per-job admin queue view would require a new, tenant-scoped, paginated backend endpoint;
that was treated as out of scope for this UI-only pass rather than adding an unreviewed endpoint, so the
job queue UI above is intentionally a bill-centric view, not a `TallyJob`-centric one.

## 20. Phase 17 — Ledger mapping, error classification, idempotency hardening

> **Phase 17 status: BLOCKED pending a real TallyPrime environment.** Like Phase 16, nothing below was
> validated against a real TallyPrime/TDL instance — this sandbox has no Windows machine or TallyPrime
> installation. Everything in this section was built and tested only against the existing mock Tally
> infrastructure (the local HTTP server standing in for TallyPrime, and `TALLY_MODE=mock`). See section 21
> for exactly what a human with a real TallyPrime machine needs to do next.

### 20.1 Ledger-mapping configuration (addresses section 14's gap, partially)

`TallyIntegration` gained one new optional field: **`discountLedger`** (`backend/src/models/business.js`,
validated in `tally.validators.js`'s `tallyConfigBody`). It joins the existing `salesLedger`/`cgstLedger`/
`sgstLedger`/`igstLedger`/`roundOffLedger` fields (all already present since Phase 6 — they were NOT new in
Phase 17, despite the Phase 17 spec listing them as if new). Fallback behavior: if `discountLedger` is unset,
an invoice's non-zero `discount` is simply never posted as a separate ledger line — exactly Phase 6's
original behavior, unchanged. No ledger name is ever fabricated.

**The real gap Phase 16 left** was on the `BillIntake` → Tally *purchase* voucher side (section 14): that
template posted only a single vendor-party-ledger line + a raw amount, with no GST ledger split at all, and
had no ledger-mapping config of its own. Phase 17 closes part of this, conservatively:

- `tally.payloadBuilder.js#buildBillJobPayload()` now attaches a `ledgerMapping` object to the connector job
  payload — built by `buildLedgerMapping()`, which includes ONLY the tenant's already-configured
  `cgstLedger`/`sgstLedger`/`igstLedger`/`roundOffLedger`/`discountLedger` field values (nothing invented; an
  unconfigured tenant gets `ledgerMapping: {}`, byte-for-byte unchanged from Phase 16's payload shape).
- `connector/src/tally/localTallyAdapter.js#buildVoucherXml()` additively emits an
  `ALLLEDGERENTRIES.LIST` line for each of `cgst`/`sgst`/`igst` on the bill **only when** both the amount is
  > 0 **and** the corresponding ledger name was configured. When `ledgerMapping` is empty/absent, the XML is
  identical to Phase 16's.
- **Explicitly NOT done**: there is still no "purchase ledger" / expense-ledger field for `BillIntake` (no
  such field was asked for in the Phase 17 spec, and inventing one would be exactly the fabricated-mapping
  risk Phase 16 flagged) — the bill's net amount still posts only against the vendor party ledger and the raw
  `AMOUNT`, same as before. This means the purchase-side voucher, even with CGST/SGST/IGST lines configured,
  is **still not a fully balanced double-entry voucher** (no debit leg for the taxable amount itself) — this
  remains a known limitation for a real production purchase-ledger posting, not something Phase 17 claims to
  have solved. A real purchase-ledger-mapping field is the natural next addition, deliberately left for a
  future phase with an explicit product/accounting decision behind it.
- GST calculation itself (Phase 4's `InvoiceCalculationService` / the bill's own stored `cgst`/`sgst`/`igst`)
  was **not** touched anywhere in this phase — only which ledger NAME an already-computed amount gets posted
  against.

### 20.2 Error classification (extends section 10 / Phase 14)

Three new `TALLY_ERROR_CODES` were added in `tally.constants.js`, with the same best-effort, MESSAGE-text
pattern matching as the existing Phase 14 codes (`tally.client.js#classifyRejection`) — **inferred from the
same class of documented TallyPrime rejection phrasing, not verified against a real instance**:

| Code | Matched phrasing (lowercased) | Retried automatically? |
|---|---|---|
| `TALLY_INVALID_LEDGER` | `ledger ... not exist / not found / does not exist` | No (configuration problem) |
| `TALLY_INVALID_VOUCHER_TYPE` | `voucher type ... not exist / not found / does not exist` | No (configuration problem) |
| `TALLY_BUSY` | `please wait` / `busy` / `another ... in progress` / `try again` | **Yes** — transient, same retry policy as `TALLY_UNREACHABLE`/`TALLY_TIMEOUT`/`TALLY_SYNC_IN_PROGRESS` |

The more specific ledger/voucher-type/busy checks run **before** the existing generic duplicate-voucher
pattern (`voucher.*exist`), since "voucher type does not exist" would otherwise also match that looser
pattern — see the code comment in `classifyRejection`. Covered by
`backend/tests/api/tally.api.test.js`'s "Phase 17: extended error classification" case and
`connector/tests/localTallyAdapter.test.js`.

### 20.3 Company-mismatch safety (confirms section 7, with one real fix)

The connector→tenant→configured-company chain was re-verified with a new test
(`tallyConnector.test.js` "COMPANY MISMATCH: connector bound to a DIFFERENT company name...") simulating a
connector whose stored `tallyCompanyName` no longer matches its tenant's current `TallyIntegration`
(distinct from the pre-existing "never configured / null" test). **This test found a real, if narrow, bug**:
`TallyJobRepository#fail()` only matched jobs in status `PROCESSING`, but the company-mismatch branch in
`TallyJobService#claim()` calls `fail()` *before* `startProcessing()` runs — at that point the job is still
`CLAIMED`, so the update silently matched nothing and the job was left stuck `CLAIMED` forever (never
`FAILED`, never re-claimable, since `listClaimable` only looks at `QUEUED`). Fixed by widening `fail()`'s
status filter to `{$in: ['PROCESSING', 'CLAIMED']}` (`backend/src/repositories/business.repositories.js`) —
a minimal, targeted fix, not a restructuring. No voucher payload is ever handed to a company-mismatched
connector, confirmed by both the pre-existing and the new test.

### 20.4 Idempotency hardening (confirms section 11, with a new regression test)

Added `tallyConnector.test.js` "IDEMPOTENCY: a late SUCCEEDED result arriving after the job was already
retried is rejected, not double-applied" — simulating "network timeout after Tally accepted the voucher":
the connector's original result POST is effectively lost, the job gets auto-retried back to `QUEUED`
(`TALLY_TIMEOUT`), and then the stale/duplicate `SUCCEEDED` report from the original attempt finally arrives.
Result: the conditional (status-guarded) update in `TallyJobRepository#succeed()` correctly rejects it (409)
because the job is no longer `PROCESSING` under that connector's claim — no duplicate `tallyReference`, no
duplicate "synced" bill-status flip, and exactly one `TallyJob` row still exists for the bill throughout. No
code change was needed here — the existing Phase 16 conditional-update design already handled this case
correctly; this is confirmation, not a fix.

### 20.5 XML injection / data safety (confirms section 15)

Backend-side coverage was extended (`backend/tests/unit/tally.xml.test.js`) for the new `discountLedger`
line (escaping `&`, `<`, `>`, `"` in a configured ledger name) and for `buildBillJobPayload`'s `ledgerMapping`
shape. Connector-side coverage was extended (`connector/tests/localTallyAdapter.test.js`) confirming the new
additive CGST/SGST/IGST lines escape a ledger name containing `&` and that an empty/absent `ledgerMapping`
produces byte-identical XML to before (regression-proofing the backward-compatibility claim in 20.1). Both
suites already had broad Phase 14/16 coverage (ampersand, quotes, apostrophes, Unicode, closing-tag/CDATA
injection attempts) which was re-run and still passes unchanged.

### 20.6 Observability

Spot-checked `connector/src/logger/index.js` and every `this.logger.*` call site in
`connector/src/jobs/runner.js` (see section 15) — no secret, Authorization header, or credential value is
ever passed to a log call; only job/connector ids, error codes/messages, and attempt metadata. No change was
needed.

### 20.7 Frontend

`frontend/src/features/tally/TallyPage.jsx` already has a "Ledger mapping" section (Phase 6/16); added a
"Discount ledger" field following the exact same convention as the existing Sales/CGST/SGST/IGST/Round-off
fields (state in `BLANK`, hydration from `GET /tally/config`, a labeled `<input>`). No other new ledger
fields required UI changes (the bill-side `ledgerMapping` reuses the same CGST/SGST/IGST/Round-off/Discount
config fields already editable here — there's no separate "bill ledger mapping" settings surface to build).

## 21. Phase 17 real-TallyPrime validation checklist

Reuses section 17's setup steps as-is (install TallyPrime, enable the HTTP/XML gateway, configure
`TALLY_MODE=http`, register a connector, etc. — not re-derived here). Once that environment exists, a human
needs to walk through the full test matrix implied by sections 17/18 plus this phase's additions:

1. **Real voucher creation** — a real bill through to a real TallyPrime voucher (section 17 step 5/18).
2. **GST intra-state (CGST+SGST) and inter-state (IGST)** — confirm both the Phase 6 invoice path (already
   configurable) and, if a purchase-ledger field is added in a future phase, the bill path post against the
   correct ledgers with the correct split; today, confirm the 20.1 additive CGST/SGST/IGST lines (where
   configured) are accepted by a real company rather than rejected as invalid ledgers.
3. **Duplicate sync** — submit the same bill/invoice twice; confirm TallyPrime's real duplicate-voucher
   rejection message actually matches the existing `DUPLICATE_VOUCHER` pattern (or update the pattern if its
   real wording differs).
4. **Company mismatch** — point a connector at the wrong real company and confirm the 20.3 fix behaves
   identically against a real reject, not just the mock.
5. **Tally unavailable** — stop the TallyPrime service/gateway mid-job and confirm `TALLY_UNREACHABLE`/retry.
6. **Connector offline/recovery** — kill the connector process, confirm the offline sweep (section 13) fires
   in the admin UI, restart it, confirm auto-recovery.
7. **Multi-tenant isolation** — two real tenants, two real companies, confirm no cross-posting.
8. **Invalid ledger / invalid customer** — misconfigure a ledger name and confirm the real TallyPrime
   rejection message actually matches the new `TALLY_INVALID_LEDGER`/`TALLY_INVALID_VOUCHER_TYPE` patterns
   added in 20.2 (these are the least-verified part of this phase — they were inferred, not observed).
9. **Revoked connector** — revoke mid-run, confirm it stops claiming (section 18).
10. **Credential validation** — confirm `authUsername`/`authPassword` (if TallyPrime is configured to require
    them) actually authenticate against a real gateway.
11. **Job retry** — force a real transient failure (e.g. briefly stop the gateway) and confirm the real retry
    cycle matches the mocked one in section 10/20.4.
12. **Result reporting** — confirm `tallyReference`/voucher number round-trips exactly as TallyPrime reports
    it (not just the mock's synthetic `LASTVCHID`/`LASTVCHNO`).
13. **Voucher read-back** — read the created voucher back from TallyPrime (via its XML export/report API) and
    confirm the amounts/ledgers match what the ERP believes it sent, including the new 20.1 GST ledger lines.

None of the above has been attempted in this environment. Until it is, this integration must be treated as
**mock-validated only**, not production-proven, for both the Phase 16 invoice path and this phase's bill
ledger-mapping/error-classification additions.
