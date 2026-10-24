const MIN = 60 * 1000;

/** Central rate-limit policy. Every group is independently tunable. */
export const RATE_LIMITS = Object.freeze({
  general: { windowMs: 15 * MIN, max: 600 },
  login: { windowMs: 15 * MIN, max: 10 },
  refresh: { windowMs: 15 * MIN, max: 60 },
  passwordReset: { windowMs: 60 * MIN, max: 5 },
  upload: { windowMs: 15 * MIN, max: 60 },
  integration: { windowMs: MIN, max: 60 },
  // Phase 13: Tally Public API (Tally/TDL -> ERP). Keyed by the presented API key, not by IP alone (see
  // middlewares/rateLimiters.js) — one tenant's integration traffic can never exhaust another's budget.
  tallyPublicApi: { windowMs: MIN, max: 120 },
  // Phase 16: Tally Connector bridge (Windows connector -> ERP). Keyed by connector identity (see
  // middlewares/rateLimiters.js) so one connector's poll/heartbeat traffic can never exhaust another
  // tenant's connector budget or the platform's general limiter (spec Step 23).
  tallyConnector: { windowMs: MIN, max: 120 },
  // Tally Bill Sync dedicated module rate limiter
  tallyBillSync: { windowMs: MIN, max: 120 },
});
