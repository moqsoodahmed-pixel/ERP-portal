import { ROLES } from './roles.js';

const crud = (m) => ['view', 'create', 'update', 'delete'].map((a) => `${m}.${a}`);

export const ALL_PERMISSIONS = Object.freeze([
  ...crud('clients'),
  ...crud('users'),
  'vendors.view', 'vendors.create', 'vendors.update', 'vendors.assign',
  ...crud('products'),
  ...crud('customers'),
  'invoices.view', 'invoices.create', 'invoices.update', 'invoices.delete', 'invoices.export', 'invoices.approve', 'invoices.issue', 'invoices.cancel',
  'gst.view', 'gst.manage', 'gst.file', 'gst.update_status',
  'gst_filings.view', 'gst_filings.create', 'gst_filings.update', 'gst_filings.submit', 'gst_filings.mark_filed',
  'gst_filing_issues.view', 'gst_filing_issues.create', 'gst_filing_issues.update', 'gst_filing_issues.resolve',
  'tally.view', 'tally.sync', 'tally.manage', 'tally.configure',
  'tally.api_keys.view', 'tally.api_keys.create', 'tally.api_keys.revoke', 'tally.api_keys.rotate',
  'reports.view', 'reports.export',
  'business.view', 'business.update',
  'audit_logs.view',
  'dashboard.view',
  'platform.view',
  'dataRequests.view', 'dataRequests.manage',
  // Phase 15: client bill intake + Tally queue. bills.review/bills.reject are the Admin review-workflow
  // actions; bills.tally_manage covers the vendor-facing Tally-processing status updates (step 15/16).
  'bills.view', 'bills.create', 'bills.update', 'bills.submit', 'bills.review', 'bills.reject',
  'bills.documents.upload', 'bills.documents.view', 'bills.tally_manage',
  'tally_queue.view',
  // Phase 16: Tally connector bridge (admin-facing credential management — the connector itself uses a
  // dedicated credential, never these JWT permissions, see tallyConnectorAuth.js).
  'tally.connector.view', 'tally.connector.manage',
]);

/** Platform-level permissions can never be granted to tenant users. */
export const PLATFORM_ONLY_PERMISSIONS = Object.freeze([
  'clients.view', 'clients.create', 'clients.update', 'clients.delete',
  'vendors.view', 'vendors.create', 'vendors.update', 'vendors.assign',
  'audit_logs.view', 'platform.view', 'tally.manage',
  // Phase 15: bill review/rejection is the Admin (here: Master Admin, the only admin-capable role this
  // platform defines) review-workflow action — never grantable to a tenant's own users.
  'bills.review', 'bills.reject',
]);
export const GRANTABLE_TO_TENANT_USERS = Object.freeze(
  ALL_PERMISSIONS.filter((p) => !PLATFORM_ONLY_PERMISSIONS.includes(p)),
);

export const ROLE_DEFAULT_PERMISSIONS = Object.freeze({
  [ROLES.MASTER_ADMIN]: [
    ...crud('clients'), ...crud('users'),
    'vendors.view', 'vendors.create', 'vendors.update', 'vendors.assign',
    'dashboard.view', 'platform.view', 'audit_logs.view', 'dataRequests.view', 'dataRequests.manage',
    'products.view', 'customers.view', 'invoices.view', 'gst.view', 'tally.view', 'tally.manage',
    'tally.api_keys.view', 'tally.api_keys.create', 'tally.api_keys.revoke', 'tally.api_keys.rotate',
    'reports.view', 'reports.export', 'business.view',
    'gst_filings.view', 'gst_filings.create', 'gst_filings.update', 'gst_filings.submit', 'gst_filings.mark_filed',
    'gst_filing_issues.view', 'gst_filing_issues.create', 'gst_filing_issues.update', 'gst_filing_issues.resolve',
    // Phase 15: Master Admin is the platform's Admin/Super Admin reviewer for client bill intake.
    'bills.view', 'bills.review', 'bills.reject', 'bills.documents.view', 'bills.tally_manage', 'tally_queue.view',
    'tally.connector.view', 'tally.connector.manage',
  ],
  [ROLES.CLIENT_ADMIN]: [
    'dashboard.view', 'business.view', 'business.update',
    ...crud('users'), ...crud('products'), ...crud('customers'),
    'invoices.view', 'invoices.create', 'invoices.update', 'invoices.delete', 'invoices.export', 'invoices.approve', 'invoices.issue', 'invoices.cancel',
    'gst.view', 'gst.manage', 'tally.view', 'tally.sync', 'tally.configure',
    'tally.api_keys.view', 'tally.api_keys.create', 'tally.api_keys.revoke', 'tally.api_keys.rotate',
    'reports.view', 'reports.export', 'dataRequests.view', 'dataRequests.manage',
    // Read-only by design (Phase 8 step 9/15): the filing workflow is vendor/admin-driven, a client never
    // creates/updates filings or resolves a vendor-owned issue.
    'gst_filings.view', 'gst_filing_issues.view',
    // Phase 15: the client/shop uploads and submits its own bills; review/reject/queue remain Admin/vendor-only.
    'bills.view', 'bills.create', 'bills.update', 'bills.submit', 'bills.documents.upload', 'bills.documents.view',
    'tally.connector.view', 'tally.connector.manage',
  ],
  [ROLES.CLIENT_USER]: [
    'dashboard.view', 'products.view', 'customers.view', 'invoices.view',
    'bills.view', 'bills.create', 'bills.update', 'bills.submit', 'bills.documents.upload', 'bills.documents.view',
  ],
  [ROLES.GST_VENDOR]: [
    'dashboard.view', 'gst.view', 'gst.update_status', 'gst.file', 'invoices.view', 'tally.view',
    // mark_filed is granted to the vendor too: Phase 1-7 already trusted GST_VENDOR with the equivalent
    // 'gst.file' permission by default, so Phase 8 keeps that same philosophy rather than inventing a new,
    // more restrictive tier — the assignment-chain check (never permission alone) is what actually gates access.
    'gst_filings.view', 'gst_filings.create', 'gst_filings.update', 'gst_filings.submit', 'gst_filings.mark_filed',
    'gst_filing_issues.view', 'gst_filing_issues.create', 'gst_filing_issues.update', 'gst_filing_issues.resolve',
    // Phase 9: view-only reports, reachable ONLY through /vendors/me/clients/:tenantId/reports/* which runs the
    // same requireVendorAssignment chain as every other vendor route (never platform-wide). No reports.export.
    'reports.view',
    // Phase 15: vendor sees assigned clients' submitted bills + Tally queue, and updates Tally processing
    // status — but never reviews/rejects (Admin-only) and never bypasses the assignment chain.
    'bills.view', 'bills.documents.view', 'bills.tally_manage', 'tally_queue.view',
  ],
});