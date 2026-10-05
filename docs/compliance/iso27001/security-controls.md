> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Control mapping (alignment, not certification)

Maps technical features to ISO/IEC 27001:2022 Annex A themes using our own wording. Applicability and justification belong in the Statement of Applicability.
| Theme | Platform capability | Gap / organisational action |
|---|---|---|
| Access control | RBAC, least-privilege grant rules, tenant isolation, vendor assignment checks, session revocation | access reviews, joiner/mover/leaver process |
| Authentication | strong password policy, lockout, short-lived tokens, rotation + reuse detection | MFA, password reset |
| Cryptography | TLS (deployment), AES-256-GCM service, keyed token hashing | key management procedure, rotation drills |
| Logging & monitoring | structured logs, append-only audit, security events | central log store, alerting, retention |
| Secure development | lint, tests incl. tenant isolation, dependency audit in CI, PR-based change | code-review policy, branch protection settings, SAST, secrets scanning |
| Asset management | models & data inventory docs | asset register `[Org]` |
| Incident management | SecurityEvent incident fields | runbook (see incident-response.md) |
| Backup & continuity | documented strategy | implement/test backups |
| Supplier security | integration ports, processor register | contracts, reviews |
| Vulnerability management | `npm audit` in CI | patch SLAs, container scanning |
| Change management | Git history, CI gates | CAB / approvals `[Org]` |
