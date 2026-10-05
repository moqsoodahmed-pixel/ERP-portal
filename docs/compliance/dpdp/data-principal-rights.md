> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Data principal rights workflows

`DataRequest` types: ACCESS, CORRECTION, ERASURE, CONSENT_WITHDRAWAL, GRIEVANCE, EXPORT. Statuses: RECEIVED -> IN_REVIEW -> FULFILLED | REJECTED -> CLOSED.
Proposed workflow `[to be implemented Phase 9-10]`: intake -> verify identity -> route to responsible tenant/operator -> perform (export / correct / anonymise / withdraw) -> record outcome in audit log (`DATA_EXPORT`, `DATA_DELETION_REQUEST`) -> respond within `[SLA]`. Grievance contact details and escalation path `[Organisation]`.
Today: `/api/v1/data-requests` returns 501.
