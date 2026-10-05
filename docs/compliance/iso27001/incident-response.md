> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Incident response plan (template)
Phases: prepare -> detect -> triage -> contain -> eradicate -> recover -> review. Severity scale and on-call roster `[Org]`.
Detection sources: `SecurityEvent` (type, severity, IP, request id), audit logs, rate-limit events. Containment levers in the product: revoke a user's refresh tokens (password change/disable), suspend a tenant, unassign a vendor, rotate secrets. Evidence: preserve logs/audit by request id. Personal-data breaches: also follow dpdp/breach-response.md. Communication and legal contacts `[Org]`.
