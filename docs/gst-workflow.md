# GST workflow

## Filing workflow (data model ready, workflow PLACEHOLDER)
Client -> Invoices -> GST filing -> assigned GST vendor -> review -> processing -> filed.
Statuses: `PENDING, ASSIGNED, UNDER_REVIEW, DATA_PREPARATION, READY_FOR_FILING, FILED, ACKNOWLEDGED, ISSUE_RAISED, RESOLVED, CANCELLED`. Every change must append a `GSTFilingStatusHistory` row (`filingId, previousStatus, newStatus, changedBy, comment, timestamp`; append-only) and an audit entry `GST_STATUS_CHANGED`. Allowed transitions and per-status permissions are defined in Phase 7.
Vendor access is limited to ACTIVE `VendorClientAssignment`s (implemented and tested). `GET /gst/filings` and `PATCH /gst/filings/:id/status` return 501 today. No GST government/ASP API is integrated.

## GST on/off
`gstApplicable: true`: taxable + GST = grand total. `false`: no tax, grand total = taxable.

## Calculation rules (PROPOSED - require review by a qualified tax professional before Phase 4 sign-off)
Implemented in `InvoiceCalculationService` as a foundation; **not validated for statutory compliance**.
1. Decimal arithmetic only (`decimal.js`), rounding mode HALF_UP, 2 decimal places.
2. Line gross = quantity (<= 3 dp) x unit price; line taxable = gross - discount (discount may not exceed gross).
3. Line tax = taxable x rate / 100, rounded per line.
4. Intra-state: CGST = round(tax/2), SGST = tax - CGST. Inter-state: IGST = tax. (Place-of-supply determination is currently a client-supplied flag - to be derived from GST config + customer state in Phase 4.)
5. Totals are sums of rounded lines; no invoice-level round-off line.
6. **Not implemented**: cess, reverse charge, composition scheme, exports/SEZ, e-invoicing/e-way bill, TCS/TDS, tax-inclusive pricing, HSN-wise tax summary, credit/debit notes.
Totals are always computed server-side; client-supplied totals are rejected.
