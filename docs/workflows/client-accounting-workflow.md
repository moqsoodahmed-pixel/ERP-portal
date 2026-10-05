# Client accounting workflow (Phase 18)

What a CLIENT_ADMIN/CLIENT_USER sees and can do across the bill -> Tally -> GST filing lifecycle, and
what they are explicitly prevented from doing.

## Visibility

- `/client/bills` — own tenant's bills only (`bills.view`), including `status` and `tallyStatus`.
- `/client/gst-filings` — own tenant's GST filing workflow tracker, read-only (`gst_filings.view` is
  granted to CLIENT_ADMIN by default; CLIENT_USER does not have it — see
  `backend/src/constants/permissions.js`).
- `/client/gst-vendor` — which vendor(s) are assigned to their account (read-only).
- `/client/tally` — Tally sync status for issued invoices (pre-existing Phase 6/9 view, unchanged).

## What a client can do

- Create/edit/submit a DRAFT bill and upload its supporting documents (`bills.create`, `bills.update`,
  `bills.submit`, `bills.documents.upload`).
- Nothing else in the accounting pipeline: `bills.review`/`bills.reject` are Master-Admin-only
  permissions (`PLATFORM_ONLY_PERMISSIONS`), and `bills.tally_manage` (processing/synced/failed/retry/
  complete) is never granted to CLIENT_ADMIN or CLIENT_USER by default.

## What a client is explicitly prevented from doing (verified by existing + Phase 18 tests)

- Cannot create, deactivate or reactivate a `VendorClientAssignment` — that router is Master-Admin-only
  (`vendors.assign`, a `PLATFORM_ONLY_PERMISSIONS` entry).
- Cannot create/claim/update a `TallyJob`, and cannot call any `bills.tally_manage` endpoint
  (`POST /bills/:id/tally/*`) — rejected with 403 at the permission layer.
- Cannot mark a GST filing `SUBMITTED` or `FILED` — `gst_filings.submit`/`gst_filings.mark_filed` are not
  in the CLIENT_ADMIN/CLIENT_USER default permission sets; the client's filing permissions are
  `gst_filings.view`/`gst_filing_issues.view` only (explicitly read-only, see the comment in
  `permissions.js`: "the filing workflow is vendor/admin-driven, a client never creates/updates filings").

## Disclaimers shown in the UI

Bill/Tally/filing statuses are labelled as this platform's own internal workflow tracker. No screen in
the client workspace claims a real TallyPrime confirmation or a real GSTN/government filing
acknowledgement — because neither exists in this codebase (see
`docs/workflows/vendor-accounting-workflow.md` sections 3-4 for the full disclaimer).
