> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Secure development policy (template)
Branching with protected `main`, mandatory PR review, CI must pass (lint, tests incl. tenant-isolation suite, dependency audit, tracked-`.env` check). No secrets in source; use `.env.example` and a secret manager. Dependencies: pinned via lockfiles, reviewed updates, `npm audit` at high severity blocks. Security tests accompany features that touch auth, tenancy or money. Threat-model new integrations before building. Pen-test before production `[Org]`.
