# Vendor accounting workflow (Phase 18)

This document describes the GST vendor's end-to-end operational workflow across bill intake,
Tally job processing and GST filing, as actually implemented. It is internal ERP workflow state
only — see the explicit disclaimers in each section below.

## 1. Scope and access

A GST vendor only ever sees data for clients they have an **ACTIVE** `VendorClientAssignment` to, on
an **ACTIVE** tenant. Every list/aggregate endpoint re-derives this assignment set server-side on each
request (`assignmentRepo.listActiveByVendor`); nothing is cached or trusted from the frontend.

- `GET /vendors/me/dashboard` — assigned-client summary: GST filing pipeline, bill accounting pipeline
  (Phase 15 `BillIntake.status`), Tally job pipeline (Phase 16 `TallyJob.status`), and open filing issues.
  All counts are MongoDB aggregations scoped to the vendor's own assignments (`dashboard.service.js#vendor`).
- `GET /bills?client=<tenantId>`, `GET /tally/queue?clientId=<tenantId>`, `GET /gst-filings?client=<tenantId>`
  — the "client workspace" view (Phase 18): narrows to ONE assigned client. The requested tenant id is
  always checked against the vendor's own active assignment list before being honoured; an id for a
  tenant the vendor is not assigned to is rejected with 403, never silently ignored or substituted.

## 2. Bill accounting lifecycle (Phase 15, reused as-is)

```
DRAFT -> SUBMITTED -> UNDER_REVIEW -> READY_FOR_TALLY -> ACCOUNTING_IN_PROGRESS -> COMPLETED
                               \-> REJECTED            \-> (Tally job FAILED, retry)
                               \-> FAILED (missing data, never force-queued)
```

- DRAFT/SUBMIT/REVIEW/REJECT are client- and Master-Admin-only transitions (`bills.review`/`bills.reject`
  are Master-Admin-only permissions — there is no vendor review step; the vendor's role begins once a bill
  reaches READY_FOR_TALLY and a `TallyJob` exists).
- The vendor-visible `tallyStatus` field (`NOT_READY -> QUEUED -> PROCESSING -> SYNCED|FAILED`) is distinct
  from `status` and is updated through `POST /bills/:id/tally/processing|synced|failed|retry`
  (`bills.tally_manage` permission).
- `tallySynced` is what actually moves the bill to `ACCOUNTING_IN_PROGRESS` (in `billIntake.service.js`);
  **`complete()` (-> COMPLETED) is a separate, explicit action** — a Tally sync success alone does not
  auto-complete a bill. In this codebase `complete` is reachable to any caller holding `bills.tally_manage`
  (the vendor), so the vendor can confirm a bill's accounting is finished once satisfied with the Tally
  result; this is the existing Phase 15 behaviour, not a new business rule invented for Phase 18.

## 3. Tally job workflow (Phase 16, reused as-is — NOT real TallyPrime)

```
QUEUED -> CLAIMED -> PROCESSING -> SUCCEEDED
                               \-> FAILED -> (retry) -> QUEUED
```

**Real TallyPrime/Windows environment validation has NOT been performed in this project, in any phase,
including Phase 18.** Every "SUCCEEDED" job status reflects only what the connector (real or the test
mock) reported back to the ERP over its own authenticated bridge API — it is not and must never be
presented as a confirmed, independently-verified TallyPrime ledger entry. UI copy in this phase
deliberately avoids wording like "Synced to TallyPrime"; it instead says "Tally job completed" /
"Awaiting Tally validation" (see `frontend/src/features/vendors/VendorsPages.jsx`).

## 4. GST filing workflow (Phase 8, reused as-is — NOT a government integration)

```
NOT_STARTED -> IN_PROGRESS -> READY_FOR_REVIEW -> SUBMITTED -> FILED
```

This is an **ERP-internal workflow tracker** (`GSTFiling.status`), entirely separate from any real
government GSTN portal. There is no ARN, no acknowledgement, no e-filing API call anywhere in this
codebase. "SUBMITTED"/"FILED" only record that a vendor or Master Admin manually marked the internal
tracker that way (`FILING_SUBMISSION_SOURCE = 'MANUALLY_RECORDED'`); they are not proof a return was
actually filed with the government. Phase 18 does not change this state machine or its semantics —
only the vendor's "client workspace" view into it (see section 1).

## 5. Notifications and audit (reused, no new types needed)

Every bill/Tally/filing transition above already emits an existing `notification.service.js` call
(`billReadyForTally`, `tallyProcessing`, `tallyFailed`, `billCompleted`, filing-status notifications) and
an existing `AUDIT_ACTIONS` entry. Phase 18 added no new notification or audit event types — only new
read paths (dashboard aggregation, client-workspace narrowing) that do not themselves represent a
business-state change worth auditing beyond the existing `ADMIN_TENANT_ACCESS`/`VENDOR_DATA_ACCESS`
pattern already recorded by the access middlewares.
