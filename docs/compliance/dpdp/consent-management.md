> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Consent management

Model: `ConsentRecord { dataPrincipalId, dataPrincipalType, purpose, noticeVersionId/noticeVersion, consentStatus GRANTED|WITHDRAWN|EXPIRED, grantedAt, withdrawnAt, source }`, tenant-scoped.
Design rules: one record per (principal, purpose); withdrawal is a new state, never a delete; link every consent to the exact notice version shown; withdrawal must be as easy as giving consent; record source (WEB/API/IMPORT/OFFLINE).
Open: capture/withdraw endpoints and UI; downstream effect of withdrawal on processing; whether consent is the lawful ground for each purpose or another ground applies `[Legal]`.
