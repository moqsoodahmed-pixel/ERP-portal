> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# DPDP readiness

Roles to decide with counsel: for **client businesses' customers' data** the client is likely the Data Fiduciary and this platform operator a Data Processor; for **platform users' own data** (client users, vendors) the operator is likely the Data Fiduciary. `[Legal to confirm]`.

| Requirement area | Technical foundation | Open work |
|---|---|---|
| Notice | `PrivacyNotice` / `PrivacyNoticeVersion` (versioned, append-only, per language) | notice content, UI display, multilingual text `[Legal]` |
| Consent | `ConsentRecord` (principal, purpose, noticeVersion, status, timestamps, source) | capture/withdraw API + UI, consent manager integration `[Legal]` |
| Purpose limitation | `Customer.processingPurpose`; consent `purpose` | purpose catalogue |
| Rights: access, correction, erasure, withdrawal, grievance | `DataRequest` (type, status, dueAt, handledBy) | workflows, SLAs, identity verification |
| Retention / erasure | `RetentionPolicy` (category, days, DELETE/ANONYMIZE/ARCHIVE, legal basis) | sweeper job; reconcile with tax/accounting retention duties `[Legal]` |
| Security safeguards | RBAC, tenant isolation, audit log, encryption service, rate limiting, secure sessions | see ISO mapping; pen-test |
| Breach handling | `SecurityEvent.isPotentialPersonalDataBreach`, incident status | notification workflow (Board/affected principals as applicable) |
| Processors | `DataProcessor` register | contracts, due diligence |
| Children | none collected; hook: add age category + verifiable parental consent flow if ever needed | decide scope `[Legal]` |
| Data export | audit action `DATA_EXPORT` reserved; export endpoints are 501 placeholders | implement with authorization + audit |
