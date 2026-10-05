> **TEMPLATE / FRAMEWORK DOCUMENT - requires organisational and legal review.**
> This document does not state or imply that the platform is certified or legally compliant. It describes technical capabilities designed for DPDP compliance readiness / ISO/IEC 27001:2022 alignment. Owners, dates and decisions in `[brackets]` must be completed by the organisation.

# Backup and recovery (strategy - NOT YET IMPLEMENTED)
Targets `[Org to set]`: RPO [x], RTO [x]. Proposed: MongoDB replica set with continuous backup/point-in-time recovery, daily snapshots retained [x] days, encrypted at rest, stored in a separate account/region, quarterly restore test with a written report. Back up object storage (documents) and secrets inventory (not the secrets in plaintext). Business continuity: stateless API containers can be redeployed; MongoDB is the single stateful dependency; `/ready` supports orchestrator health gating. Disaster recovery runbook: Phase 12.
