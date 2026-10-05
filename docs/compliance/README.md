> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Compliance framework

Designed for **DPDP compliance readiness** (Digital Personal Data Protection Act, 2023 and applicable Rules) and **ISO/IEC 27001:2022 alignment**. Certification or legal compliance requires organisational processes, policies, contracts, operational controls, audits and professional/legal review. No proprietary ISO text is reproduced.

| Folder | Contents |
|---|---|
| `dpdp/` | readiness framework: data inventory, consent, rights workflows, retention, breach response, processors |
| `iso27001/` | control mapping and policy/risk templates |

## What the code provides today vs. what is still open
| Capability | State |
|---|---|
| Models: ConsentRecord, DataRequest, PrivacyNotice(+Version, append-only), RetentionPolicy, DataProcessor, SecurityEvent (incident fields), AuditLog | Schemas only (no API/workflow yet) |
| RBAC, tenant isolation, audit logging, encryption service, security events | Implemented + tested |
| Consent capture UI/API, data-principal request workflows, export, retention/anonymisation jobs, breach notification workflow | **Not implemented** (Phase 9-10) |
| Policies, risk register, SoA, supplier contracts, training, audits | **Organisational work** (templates provided) |
