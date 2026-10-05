> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Change management (template)
All changes via Git pull requests linked to a ticket. Classification: standard / normal / emergency `[Org]`. Required: review, passing CI, rollback plan, migration notes for schema/index changes (`syncIndexes` is deliberate, never automatic in production). Record deployments (who/when/version) `[Phase 11]`. Emergency changes get retrospective review within `[x]` days.
