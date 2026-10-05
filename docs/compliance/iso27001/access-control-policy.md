> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Access control policy (template)
Purpose, scope, roles `[Org]`. Principles: least privilege; need-to-know; separation of duties (platform vs tenant vs vendor); no shared accounts; privileged (Master Admin) actions are authenticated, authorised and audited, and tenant access requires explicit context.
Provisioning: Master Admin creates clients, vendors and assignments; Client Admins create users within their tenant and cannot grant permissions they lack. Review user lists and vendor assignments every `[quarter]`. Offboarding: disable the user (revokes sessions) the same day. Authentication standards: see docs/authentication.md; MFA `[planned]`. Exceptions: documented and time-boxed `[Org]`.
