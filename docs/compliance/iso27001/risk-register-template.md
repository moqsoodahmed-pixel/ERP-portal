> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Risk register (template)
| ID | Asset | Threat | Vulnerability | Likelihood (1-5) | Impact (1-5) | Score | Owner | Treatment | Status |
|---|---|---|---|---|---|---|---|---|---|
| R-001 | Tenant data | Cross-tenant access | Missing tenant filter | [ ] | [ ] | [ ] | [ ] | Tenant-scoped repositories + isolation tests | [ ] |
| R-002 | Credentials | Refresh token theft | Stolen cookie | [ ] | [ ] | [ ] | [ ] | Rotation + reuse detection | [ ] |
| R-003 | Tally credentials | Disclosure | DB leak | [ ] | [ ] | [ ] | [ ] | Field encryption, key mgmt | [ ] |
Scoring method, acceptance criteria and review cadence: `[Organisation]`.
