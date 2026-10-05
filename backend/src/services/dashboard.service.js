import {
  INVOICE_STATUS, TALLY_SYNC_STATUS, FILING_STATUS, FILING_ISSUE_STATUS, PRODUCT_STATUS, CUSTOMER_STATUS,
  BILL_STATUS, TALLY_JOB_STATUS,
} from '../constants/statuses.js';
import { resolveDateRange } from '../utils/dateRange.js';

const OPEN_ISSUE = [FILING_ISSUE_STATUS.OPEN, FILING_ISSUE_STATUS.IN_PROGRESS];
const FILING_KEYS = Object.values(FILING_STATUS);
/** A metric that does not apply / is not visible to the caller — explicitly distinct from a real zero. */
const na = (reason, extra = {}) => ({ available: false, reason, ...extra });
/** Zero-filled status counts from a `{_id, count}` aggregation ($group on a known enum). */
const countsFromRows = (rows, keys) => {
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) if (r._id !== null && r._id !== undefined) out[r._id] = (out[r._id] ?? 0) + r.count;
  return out;
};

/**
 * Phase 9 — role-aware dashboards. All figures are server-side MongoDB aggregations/counts (via the shared
 * ReportService metric queries and ReportRepository scope rules); the frontend never totals raw rows.
 *  - client(): tenant from resolveTenant (own tenant, or Master Admin's audited X-Admin-Tenant-Id).
 *  - master(): EXTENDS ClientService.dashboard() (Phase 2) — its fields are returned unchanged and new
 *    platform aggregates are added alongside.
 *  - vendor(): tenant set derived ONLY from the vendor's own ACTIVE assignments to ACTIVE tenants.
 */
export class DashboardService {
  constructor({ reportService, reportRepo, clientService, assignmentRepo, tenantRepo, securityEventRepo }) {
    Object.assign(this, { reportService, reportRepo, clientService, assignmentRepo, tenantRepo, securityEventRepo });
  }

  async client(ctx, query = {}) {
    const range = resolveDateRange(query);
    const scope = { tenantIds: [String(ctx.tenantId)] };
    const has = (p) => ctx.permissions.has(p);
    const inRange = { invoiceDate: { $gte: range.from, $lte: range.to } };
    const issuedInRange = { ...inRange, invoiceStatus: INVOICE_STATUS.ISSUED };
    const rs = this.reportService;

    const invoices = has('invoices.view') ? {
      available: true,
      byStatus: await rs.countBy('Invoice', scope, inRange, 'invoiceStatus', Object.values(INVOICE_STATUS)),
      issued: await rs.invoiceTotals(scope, issuedInRange),
      payments: na('Invoice.paymentStatus exists but no payment-recording workflow is implemented; every invoice remains UNPAID by default, so paid/outstanding amounts are not reported.', { paidAmount: null, outstandingAmount: null }),
    } : na('PERMISSION_REQUIRED', { permission: 'invoices.view' });

    const customers = has('customers.view')
      ? { available: true, active: await this.reportRepo.count('Customer', scope, { status: CUSTOMER_STATUS.ACTIVE }) }
      : na('PERMISSION_REQUIRED', { permission: 'customers.view' });
    const products = has('products.view')
      ? { available: true, active: await this.reportRepo.count('Product', scope, { status: PRODUCT_STATUS.ACTIVE }) }
      : na('PERMISSION_REQUIRED', { permission: 'products.view' });

    const tally = has('tally.view')
      ? { available: true, scope: 'ISSUED invoices dated within the selected range', ...(await rs.tallyBreakdown(scope, issuedInRange)) }
      : na('PERMISSION_REQUIRED', { permission: 'tally.view' });

    let gstFilings;
    if (!has('gst_filings.view')) gstFilings = na('PERMISSION_REQUIRED', { permission: 'gst_filings.view' });
    else {
      const [latest] = await this.reportRepo.find('GSTFiling', scope, {}, { sort: { periodKey: -1 }, limit: 1 });
      if (!latest) gstFilings = na('No GST filing workflow has been created for this client yet.');
      else {
        const filings = await this.reportRepo.find('GSTFiling', scope, { periodKey: latest.periodKey }, { sort: { returnType: 1 } });
        const openByFiling = await this.reportRepo.aggregate('GSTFilingIssue', scope, { status: { $in: OPEN_ISSUE } }, [
          { $group: { _id: '$filingId', count: { $sum: 1 } } },
        ]);
        const openMap = new Map(openByFiling.map((r) => [String(r._id), r.count]));
        gstFilings = {
          available: true,
          latestPeriod: latest.periodKey,
          filings: filings.map((f) => ({ _id: f._id, returnType: f.returnType, status: f.status, progressPercent: f.progressPercent ?? 0, openIssues: openMap.get(String(f._id)) ?? 0 })),
          openIssuesTotal: openByFiling.reduce((s, r) => s + r.count, 0),
        };
      }
    }

    return { scope: 'TENANT', range, invoices, customers, products, tally, gstFilings };
  }

  async master(query = {}) {
    const range = resolveDateRange(query);
    const all = { allTenants: true };
    const rs = this.reportService;
    const [base, filingPipeline, openIssues, tallyByStatus, invoiceByStatus, securityTotal, securityHigh] = await Promise.all([
      this.clientService.dashboard(),
      rs.countBy('GSTFiling', all, {}, 'status', FILING_KEYS),
      this.reportRepo.count('GSTFilingIssue', all, { status: { $in: OPEN_ISSUE } }),
      rs.countBy('TallySyncLog', all, { startedAt: { $gte: range.from, $lte: range.to } }, 'status', Object.values(TALLY_SYNC_STATUS)),
      rs.countBy('Invoice', all, { invoiceDate: { $gte: range.from, $lte: range.to } }, 'invoiceStatus', Object.values(INVOICE_STATUS)),
      this.securityEventRepo.countInRange(range.from, range.to),
      this.securityEventRepo.countInRange(range.from, range.to, { severity: { $in: ['HIGH', 'CRITICAL'] } }),
    ]);
    return {
      ...base, // Phase 2 fields (clients, users, gstVendors, activeVendorAssignments) — unchanged
      range,
      gstFilings: { pipeline: filingPipeline, openIssues, note: 'Current workflow state across all tenants (not date-filtered).' },
      tallySync: { byStatus: tallyByStatus, note: 'Sync attempts started within the selected range, all tenants.' },
      invoices: { byStatus: invoiceByStatus, note: 'Counts only (by invoiceDate in range), all tenants.' },
      securityEvents: { total: securityTotal, highOrCritical: securityHigh, note: 'Recorded security events within the selected range.' },
    };
  }

  async vendor(ctx) {
    const assignments = await this.assignmentRepo.listActiveByVendor(ctx.actor.vendorId);
    const tenants = (await this.tenantRepo.findByIds(assignments.map((a) => a.tenantId)))
      .filter((t) => t && !t.isDeleted && t.status === 'ACTIVE');
    const scope = { tenantIds: tenants.map((t) => String(t._id)) };
    const [byTenantStatus, openByTenant, billByStatus, tallyJobByStatus] = await Promise.all([
      this.reportRepo.aggregate('GSTFiling', scope, {}, [{ $group: { _id: { tenantId: '$tenantId', status: '$status' }, count: { $sum: 1 } } }]),
      this.reportRepo.aggregate('GSTFilingIssue', scope, { status: { $in: OPEN_ISSUE } }, [{ $group: { _id: '$tenantId', count: { $sum: 1 } } }]),
      // Phase 18: bill-intake accounting pipeline (Phase 15) across the vendor's assigned clients only.
      this.reportRepo.aggregate('BillIntake', scope, {}, [{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      // Phase 18: Tally job pipeline (Phase 16) — TallyJob is itself tenant-scoped (tenantPlugin), so the
      // same scope can be applied directly, with no cross-collection lookup needed.
      this.reportRepo.aggregate('TallyJob', scope, {}, [{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);
    const bills = countsFromRows(billByStatus, Object.values(BILL_STATUS));
    const tallyJobs = countsFromRows(tallyJobByStatus, Object.values(TALLY_JOB_STATUS));
    const pipeline = Object.fromEntries(FILING_KEYS.map((k) => [k, 0]));
    const perTenant = new Map(tenants.map((t) => [String(t._id), { tenantId: t._id, businessName: t.businessName, pipeline: Object.fromEntries(FILING_KEYS.map((k) => [k, 0])), openIssues: 0 }]));
    for (const r of byTenantStatus) {
      pipeline[r._id.status] = (pipeline[r._id.status] ?? 0) + r.count;
      const row = perTenant.get(String(r._id.tenantId));
      if (row) row.pipeline[r._id.status] += r.count;
    }
    for (const r of openByTenant) { const row = perTenant.get(String(r._id)); if (row) row.openIssues = r.count; }
    const total = Object.values(pipeline).reduce((s, n) => s + n, 0);
    return {
      scope: 'VENDOR_ASSIGNED_TENANTS',
      assignedClients: assignments.length,
      activeAssignedClients: tenants.length,
      gstFilings: { pipeline, total, inProgress: total - pipeline.FILED, openIssues: openByTenant.reduce((s, r) => s + r.count, 0) },
      // Phase 18: bill-accounting + Tally job pipelines, same "ACTIVE assignment to an ACTIVE tenant only" scope.
      bills: { byStatus: bills, pendingReview: bills[BILL_STATUS.SUBMITTED] + bills[BILL_STATUS.UNDER_REVIEW], note: 'Internal ERP bill-intake workflow status (Phase 15), not a Tally or government confirmation.' },
      tallyJobs: { byStatus: tallyJobs, retryable: tallyJobs[TALLY_JOB_STATUS.FAILED], note: 'Tally job queue status only — "SUCCEEDED" means the connector reported success; no real TallyPrime environment has been validated against this platform (see docs/workflows).' },
      clients: [...perTenant.values()],
      note: 'Only clients with an ACTIVE assignment to you and an ACTIVE account are counted. Workflow state is current (not date-filtered).',
    };
  }
}
