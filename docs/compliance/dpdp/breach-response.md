> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Personal data breach response (template)

Detection inputs available now: `SecurityEvent` (token reuse, tenant violations, lockouts, rate-limit hits) and audit logs.
Steps `[Organisation to adopt]`: 1 triage and open incident (`incidentStatus OPEN`) -> 2 contain (revoke token families, disable users, suspend tenant) -> 3 assess whether personal data is affected (`isPotentialPersonalDataBreach`) -> 4 notify as required by law within the prescribed timelines `[Legal]` -> 5 remediate and document -> 6 post-incident review.
Roles: incident lead, legal/DPO-equivalent, communications `[names]`. Contact tree and regulator-notification templates `[Legal]`.
