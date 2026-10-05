> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Data inventory (starting point - verify and extend)

| Data | Subject | Where | Purpose | Sensitivity | Protection today |
|---|---|---|---|---|---|
| name, email, password hash, role | platform users, vendors | `users` | authentication, access control | personal | bcrypt hash, RBAC, never serialised |
| IP address, user agent | users | `auditlogs`, `securityevents`, `refreshtokens` | security & accountability | personal | access limited to Master Admin; retention TBD |
| customer name, business, GSTIN, PAN, phone, email, addresses | client's customers | `customers`, invoices (by reference) | invoicing, GST compliance | personal / business | tenant isolation, RBAC |
| business name, GSTIN, PAN, contact | clients | `tenants`, `businessprofiles` | service delivery | business (may include personal) | tenant isolation |
| vendor contact | GST vendors | `vendors` | filing operations | personal | RBAC |
| Tally credentials | clients | `tallyintegrations` (future) | integration | secret | AES-256-GCM, `select:false` |
| consent / request records | principals | `consentrecords`, `datarequests` | accountability | personal | schema only |
Not collected: Aadhaar, financial account numbers, health data, biometric data. `[Confirm before adding any]`.
