/**
 * Background job registry. NOT IMPLEMENTED.
 * Planned jobs (see docs/architecture.md): tally-sync worker, retention/anonymisation sweeper, expired-idempotency cleanup (TTL index handles this today).
 * A queue technology will be chosen when Phase 6 requires one; the modular monolith runs without it.
 */
export const jobs = Object.freeze([]);
