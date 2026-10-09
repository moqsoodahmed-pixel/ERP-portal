const e = (...v) => Object.freeze(Object.fromEntries(v.map((x) => [x, x])));

export const TENANT_STATUS = e('ACTIVE', 'SUSPENDED', 'INACTIVE', 'PENDING');
export const USER_STATUS = e('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING');
export const INVOICE_STATUS = e('DRAFT', 'ISSUED', 'CANCELLED');
export const PAYMENT_STATUS = e('UNPAID', 'PARTIALLY_PAID', 'PAID');
export const TALLY_SYNC_STATUS = e('NOT_SYNCED', 'QUEUED', 'SYNCING', 'SYNCED', 'FAILED', 'RETRYING');
export const GST_FILING_STATUS = e(
  'PENDING', 'ASSIGNED', 'UNDER_REVIEW', 'DATA_PREPARATION', 'READY_FOR_FILING',
  'FILED', 'ACKNOWLEDGED', 'ISSUE_RAISED', 'RESOLVED', 'CANCELLED',
);

/**
 * Phase 8 — ERP-internal GST filing WORKFLOW TRACKER state machine (distinct from the per-invoice
 * `gstFilingStatus` field above, which is left untouched). This is NOT a government portal integration;
 * see docs/gst-filing-workflow.md and the GSTFiling model comments.
 */
export const FILING_STATUS = e('NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'SUBMITTED', 'FILED');
export const FILING_RETURN_TYPE = e('GSTR_1', 'GSTR_3B');
export const FILING_SUBMISSION_SOURCE = e('MANUALLY_RECORDED');

/**
 * Phase 20 — GST Bill <-> Tally bill-by-bill matching. Per-line-item result (one per GSTBill.items[]
 * entry, since GSTBill has no separate per-bill identifier/sub-collection — see GSTBillMatch model doc
 * comment) and the overall filing-level verdict derived ONLY from the individual results below (never a
 * value the client/frontend can submit directly).
 */
export const GST_BILL_MATCH_STATUS = e('MATCHED', 'MISMATCH', 'NOT_FOUND', 'DUPLICATE', 'ERROR');
export const GST_BILL_OVERALL_MATCH_STATUS = e('FULLY_MATCHED', 'PARTIAL_MATCH', 'NOT_MATCHED', 'TALLY_ERROR');
export const FILING_MILESTONE_STATUS = e('PENDING', 'IN_PROGRESS', 'DONE');

export const FILING_ISSUE_TYPE = e(
  'MISSING_DATA', 'GST_MISMATCH', 'INVOICE_MISMATCH', 'CUSTOMER_DATA', 'PRODUCT_DATA', 'TALLY_SYNC', 'TAX_CALCULATION', 'DOCUMENT', 'OTHER',
);
export const FILING_ISSUE_SEVERITY = e('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
export const FILING_ISSUE_STATUS = e('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
/**
 * Phase 9 — persistent in-app notifications. Every type maps to an authoritative service-layer transition
 * (see services/notification.service.js); nothing is generated from controllers or fabricated.
 * Severity is a deliberately separate INFO/WARNING/CRITICAL scale: the existing LOW/MEDIUM/HIGH/CRITICAL
 * enum (security events, filing issues) is a *risk* scale with no "informational" level.
 */
export const NOTIFICATION_TYPE = e(
  'INVOICE_ISSUED', 'INVOICE_CANCELLED', 'TALLY_SYNC_FAILED', 'TALLY_SYNC_SUCCEEDED',
  'GST_FILING_READY', 'GST_FILING_SUBMITTED', 'GST_FILING_FILED', 'GST_FILING_ISSUE_OPENED', 'GST_FILING_ISSUE_RESOLVED',
  'CLIENT_STATUS_CHANGED', 'VENDOR_ASSIGNMENT_CHANGED',
  // Phase 15: bill intake + Tally queue notifications.
  'BILL_SUBMITTED', 'BILL_REJECTED', 'BILL_READY_FOR_TALLY', 'TALLY_PROCESSING', 'TALLY_FAILED', 'BILL_COMPLETED',
  'NEW_BILL_READY_FOR_TALLY', 'IMPORTANT_TALLY_FAILURE', 'WORKFLOW_EXCEPTION',
  // Phase 16: Tally connector bridge.
  'CONNECTOR_OFFLINE',
);
export const NOTIFICATION_SEVERITY = e('INFO', 'WARNING', 'CRITICAL');
export const PRODUCT_STATUS = e('ACTIVE', 'INACTIVE', 'ARCHIVED');
export const CUSTOMER_STATUS = e('ACTIVE', 'INACTIVE', 'ARCHIVED');
export const ASSIGNMENT_STATUS = e('ACTIVE', 'INACTIVE');
export const CONSENT_STATUS = e('GRANTED', 'WITHDRAWN', 'EXPIRED');
export const DATA_REQUEST_TYPE = e('ACCESS', 'CORRECTION', 'ERASURE', 'CONSENT_WITHDRAWAL', 'GRIEVANCE', 'EXPORT');
export const DATA_REQUEST_STATUS = e('RECEIVED', 'IN_REVIEW', 'FULFILLED', 'REJECTED', 'CLOSED');
export const INCIDENT_STATUS = e('OPEN', 'INVESTIGATING', 'CONTAINED', 'RESOLVED');
export const IDEMPOTENCY_STATUS = e('IN_PROGRESS', 'COMPLETED');
export const DOCUMENT_TYPE = e('INVOICE_PDF');
export const ENTITY_TYPE = e('INVOICE');
export const DOCUMENT_STATUS = e('AVAILABLE');
export const TALLY_API_KEY_STATUS = e('ACTIVE', 'REVOKED', 'EXPIRED');

/**
 * Phase 15 — CLIENT BILL INTAKE + TALLY QUEUE.
 *
 * BILL_STATUS is the ERP-owned workflow status (step 5 of the spec): kept strictly separate from
 * BILL_TALLY_STATUS, which only ever describes the bill's progress through the (future) Tally connector.
 * FAILED is an ERP-level terminal state reached only when a bill cannot proceed to Tally for a documented
 * reason (missing bill number/date/vendor/documents) — see BillIntakeService#assessTallyReadiness. It is
 * distinct from BILL_TALLY_STATUS.FAILED, which records a failed Tally processing attempt on a bill that
 * DID pass ERP readiness and reach the queue.
 */
export const BILL_STATUS = e(
  'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'READY_FOR_TALLY', 'ACCOUNTING_IN_PROGRESS', 'COMPLETED', 'REJECTED', 'FAILED',
);
export const BILL_TALLY_STATUS = e('NOT_READY', 'QUEUED', 'PROCESSING', 'SYNCED', 'FAILED');

/**
 * Phase 16 — TALLY CONNECTOR BRIDGE.
 *
 * TallyConnector is the registered Windows connector identity (Side B credential record) — see
 * docs/integrations/tally-connector.md. ACTIVE/INACTIVE/REVOKED only; there is no "pending approval"
 * state in this phase (registration is immediate, admin-initiated).
 *
 * TallyJob is the work-queue row bridging a BillIntake to a connector. Only one job type exists:
 * SYNC_BILL_TO_TALLY (spec Step 9 — no speculative job types). State machine (spec Step 17):
 *   QUEUED -> CLAIMED -> PROCESSING -> SUCCEEDED
 *                                   \-> FAILED -> (retry) -> QUEUED
 * SUCCEEDED is terminal: no reversal path exists.
 */
export const TALLY_CONNECTOR_STATUS = e('ACTIVE', 'INACTIVE', 'REVOKED');
export const TALLY_JOB_TYPE = e('SYNC_BILL_TO_TALLY');
export const TALLY_JOB_STATUS = e('QUEUED', 'CLAIMED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

export const AUDIT_ACTIONS = e(
  'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REUSE_DETECTED', 'PASSWORD_CHANGED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DISABLED',
  'TENANT_CREATED', 'TENANT_UPDATED', 'TENANT_STATUS_CHANGED',
  'CLIENT_ADMIN_CREATED', 'CLIENT_ADMIN_UPDATED',
  'UNAUTHORIZED_ACCESS_ATTEMPT', 'CROSS_TENANT_ACCESS_ATTEMPT',
  'BUSINESS_PROFILE_CREATED', 'BUSINESS_PROFILE_UPDATED',
  'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ARCHIVED',
  'CUSTOMER_CREATED', 'CUSTOMER_UPDATED', 'CUSTOMER_ARCHIVED',
  'INVOICE_CREATED', 'INVOICE_UPDATED', 'INVOICE_ISSUED', 'INVOICE_CANCELLED',
  'INVOICE_PDF_GENERATED', 'INVOICE_PDF_ACCESSED', 'INVOICE_PDF_REGENERATED',
  'GST_STATUS_CHANGED',
  'TALLY_SYNC_STARTED', 'TALLY_SYNC_COMPLETED', 'TALLY_SYNC_FAILED',
  'TALLY_INTEGRATION_CREATED', 'TALLY_INTEGRATION_UPDATED', 'TALLY_CONNECTION_TESTED',
  'TALLY_SYNC_SUCCEEDED', 'TALLY_SYNC_RETRIED',
  'VENDOR_CREATED', 'VENDOR_UPDATED', 'VENDOR_ASSIGNED', 'VENDOR_UNASSIGNED', 'VENDOR_ASSIGNMENT_REACTIVATED',
  'ADMIN_TENANT_ACCESS', 'VENDOR_DATA_ACCESS',
  'DATA_EXPORT', 'DATA_DELETION_REQUEST',
  'GST_FILING_CREATED', 'GST_FILING_UPDATED', 'GST_FILING_STARTED', 'GST_FILING_READY', 'GST_FILING_SUBMITTED', 'GST_FILING_MARKED_FILED',
  'GST_FILING_ISSUE_CREATED', 'GST_FILING_ISSUE_UPDATED', 'GST_FILING_ISSUE_RESOLVED', 'GST_FILING_ISSUE_CLOSED',
  // Phase 13: Tally public API key lifecycle (Tally/TDL -> ERP direction; see docs/api/tally-public-api.md).
  'TALLY_API_KEY_CREATED', 'TALLY_API_KEY_REVOKED', 'TALLY_API_KEY_ROTATED', 'TALLY_API_KEY_EXPIRED',
  'TALLY_API_KEY_AUTH_FAILED', 'TALLY_API_SCOPE_DENIED', 'TALLY_PUBLIC_API_SYNC_REQUESTED',
  // Phase 15: bill intake + Tally queue lifecycle.
  'BILL_CREATED', 'BILL_UPDATED', 'BILL_SUBMITTED', 'BILL_REVIEW_STARTED', 'BILL_READY_FOR_TALLY',
  'BILL_REJECTED', 'BILL_FAILED', 'TALLY_QUEUE_CREATED', 'TALLY_PROCESSING_STARTED',
  'TALLY_PROCESSING_SUCCEEDED', 'TALLY_PROCESSING_FAILED', 'BILL_COMPLETED',
  'BILL_DOCUMENT_UPLOADED', 'BILL_DOCUMENT_ACCESSED',
  // Phase 16: Tally connector bridge (connector credential lifecycle + job lifecycle).
  'TALLY_CONNECTOR_CREATED', 'TALLY_CONNECTOR_REVOKED', 'TALLY_CONNECTOR_ROTATED',
  'TALLY_CONNECTOR_AUTH_FAILED', 'TALLY_CONNECTOR_SCOPE_DENIED', 'TALLY_CONNECTOR_HEARTBEAT',
  'TALLY_JOB_CREATED', 'TALLY_JOB_CLAIMED', 'TALLY_JOB_CLAIM_CONFLICT', 'TALLY_JOB_SUCCEEDED', 'TALLY_JOB_FAILED', 'TALLY_JOB_RETRIED',
  // Phase 16.1: scheduled offline monitor transitions.
  'TALLY_CONNECTOR_OFFLINE', 'TALLY_CONNECTOR_RECOVERED',
  // Phase 19: GST Bill Builder (filing-scoped internal GST sales bill).
  'GST_BILL_CREATED', 'GST_BILL_UPDATED', 'GST_BILL_DOCUMENT_UPLOADED',
  // Phase 20: GST Bill <-> Tally bill-by-bill matching.
  'TALLY_MATCH_STARTED', 'TALLY_MATCH_COMPLETED', 'TALLY_MATCH_FAILED',
  // Phase 21: vendor final-document upload (client GST Billing Dashboard visibility).
  'GST_FINAL_DOCUMENT_UPLOADED',
);

export const SECURITY_EVENT_TYPES = e(
  'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'ACCOUNT_SUSPENDED', 'TOKEN_REUSE_DETECTED', 'INVALID_TOKEN',
  'CROSS_TENANT_ACCESS', 'UNAUTHORIZED_ACCESS', 'RATE_LIMIT_TRIGGERED',
  'TALLY_API_KEY_AUTH_FAILED', 'TALLY_API_SCOPE_DENIED',
  'TALLY_CONNECTOR_AUTH_FAILED', 'TALLY_CONNECTOR_SCOPE_DENIED',
);