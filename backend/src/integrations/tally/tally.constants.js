export const TALLY_SYNC_EVENTS = Object.freeze({
  STARTED: 'TALLY_SYNC_STARTED', SUCCESS: 'TALLY_SYNC_SUCCESS', FAILED: 'TALLY_SYNC_FAILED', DATA_UPDATED: 'TALLY_DATA_UPDATED',
});
export const TALLY_OPERATIONS = Object.freeze({ CREATE: 'CREATE', UPDATE: 'UPDATE', CANCEL: 'CANCEL' });

export const TALLY_ERROR_CODES = Object.freeze({
  NOT_IMPLEMENTED: 'TALLY_NOT_IMPLEMENTED',
  NOT_CONFIGURED: 'TALLY_NOT_CONFIGURED',
  DISABLED: 'TALLY_DISABLED',
  UNREACHABLE: 'TALLY_UNREACHABLE',
  TIMEOUT: 'TALLY_TIMEOUT',
  REJECTED: 'TALLY_REJECTED',
  MAPPING_MISSING: 'TALLY_MAPPING_MISSING',
  MALFORMED_RESPONSE: 'TALLY_MALFORMED_RESPONSE',
  RESPONSE_TOO_LARGE: 'TALLY_RESPONSE_TOO_LARGE',
  INVALID_URL: 'TALLY_INVALID_URL',
  // Phase 14: finer-grained classification of a REJECTED voucher response, inferred from Tally's own
  // MESSAGE text (Tally's XML protocol has no structured error-code field — this is the only signal
  // available). Falls back to the generic REJECTED code when the message doesn't match either pattern.
  COMPANY_NOT_FOUND: 'TALLY_COMPANY_NOT_FOUND',
  DUPLICATE_VOUCHER: 'TALLY_DUPLICATE_VOUCHER',
  // Phase 17: a SMALL, conservative extension of the same best-effort MESSAGE-text classification above —
  // added only for rejection phrasing that TallyPrime's own documented "Import Data" error messages are
  // known to use (ledger/voucher-type-not-found wording, and the "please wait"/busy wording Tally shows
  // when another import or report is in progress). These have NOT been verified against a real TallyPrime
  // instance in this environment (no Windows/Tally available here — see docs/integrations/tally-connector.md
  // "Phase 17 status"); they are inferred from the same kind of documented message phrasing as the Phase 14
  // codes above, not invented speculatively, and must be confirmed against a real TallyPrime reject message
  // before being relied on for anything beyond generic retry/no-retry routing.
  INVALID_LEDGER: 'TALLY_INVALID_LEDGER',
  INVALID_VOUCHER_TYPE: 'TALLY_INVALID_VOUCHER_TYPE',
  BUSY: 'TALLY_BUSY',
  // Invoice eligibility
  INVOICE_NOT_ISSUED: 'TALLY_INVOICE_NOT_ISSUED',
  INVOICE_CANCELLED_UNSYNCED: 'TALLY_INVOICE_CANCELLED_UNSYNCED',
  // Idempotency / sync-record state
  SYNC_IN_PROGRESS: 'TALLY_SYNC_IN_PROGRESS',
  RETRY_LIMIT_EXCEEDED: 'TALLY_RETRY_LIMIT_EXCEEDED',
});

/** Default retry policy. Overridable per-tenant via TallyIntegration.retryPolicy.maxAttempts. */
export const TALLY_RETRY_POLICY = Object.freeze({ maxAttempts: 3, backoffSeconds: [30, 120, 600] });

/** One tenant-configurable voucher type; "Sales" is Tally's canonical default for outward invoices. */
export const TALLY_VOUCHER_TYPES = Object.freeze(['Sales', 'Sales Invoice', 'Journal']);
export const DEFAULT_VOUCHER_TYPE = 'Sales';

/**
 * Phase 13 — scopes grantable to a Tally Public API key (Tally/TDL -> ERP direction, see
 * docs/api/tally-public-api.md). Only scopes actually enforced by an implemented endpoint exist here;
 * do not add a scope speculatively.
 */
export const TALLY_API_SCOPES = Object.freeze([
  'tally:company:read', 'tally:customer:read', 'tally:product:read', 'tally:invoice:read', 'tally:sync',
]);
export const TALLY_API_KEY_PREFIX = 'tk_live_';

/**
 * Phase 16 — scopes grantable to a Tally CONNECTOR credential (Windows connector -> ERP direction; this is
 * a DIFFERENT credential type from the Tally Public API key above — see docs/integrations/tally-connector.md
 * and tallyConnector.service.js). Deliberately minimal (spec Step 6): a connector never gets normal ERP
 * user permissions, only these three.
 */
export const TALLY_CONNECTOR_SCOPES = Object.freeze(['tally:connector:poll', 'tally:connector:submit', 'tally:connector:heartbeat']);
export const TALLY_CONNECTOR_SECRET_PREFIX = 'tconn_live_';

/** Job types the connector is ever allowed to execute (spec Step 9/14) — no speculative types. */
export const TALLY_JOB_TYPES = Object.freeze(['SYNC_BILL_TO_TALLY']);

/** Bounded retry policy for TallyJob (spec Step 18) — mirrors TALLY_RETRY_POLICY above but is its own
 * policy object since job retry is a connector-bridge concept, not a direct-sync concept. */
export const TALLY_JOB_RETRY_POLICY = Object.freeze({ maxAttempts: 5, backoffSeconds: [30, 60, 300, 900, 3600] });

/** Network/transport safety limits (see tally.ssrf.js). Never 0/infinite. */
export const TALLY_NETWORK_DEFAULTS = Object.freeze({
  timeoutMs: 10_000,
  maxTimeoutMs: 60_000,
  minTimeoutMs: 1_000,
  maxResponseBytes: 2 * 1024 * 1024, // 2 MB cap on the Tally response body
  allowedProtocols: ['http:', 'https:'],
});

/**
 * The sync-record status set reuses the existing `TALLY_SYNC_STATUS` enum from constants/statuses.js
 * (NOT_SYNCED, QUEUED, SYNCING, SYNCED, FAILED, RETRYING) rather than inventing a second one: QUEUED is
 * this feature's "PENDING" (a TallySync row exists but Tally has not been called yet).
 */
