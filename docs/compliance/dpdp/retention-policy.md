> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Retention policy (template)

| Category | Proposed retention | Action | Basis `[Legal to confirm]` |
|---|---|---|---|
| Invoices, GST filings | [per applicable tax/accounting law] | ARCHIVE then DELETE | statutory |
| Customer master data (non-invoiced) | [x] after last activity | ANONYMIZE | purpose fulfilled |
| Audit logs | [x months/years] | ARCHIVE | security / accountability |
| Security events | [x months] | DELETE | security |
| Refresh tokens | until expiry (TTL index) | DELETE | operational |
| Idempotency keys | 24h (TTL index) | DELETE | operational |
Implementation: `RetentionPolicy` documents drive a future sweeper job (`backend/src/jobs`, not implemented). Erasure requests must be reconciled with statutory retention before deletion; prefer anonymisation where records must remain.
