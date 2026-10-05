import {
  AppError, NotFoundError, ValidationError,
} from '../utils/errors.js';
import {
  AUDIT_ACTIONS, INVOICE_STATUS, TALLY_SYNC_STATUS, FILING_STATUS, FILING_ISSUE_STATUS, CUSTOMER_STATUS,
} from '../constants/statuses.js';
import { parsePagination, buildPageMeta } from '../utils/pagination.js';
import { resolveDateRange } from '../utils/dateRange.js';
import { toCsv } from '../utils/csv.js';
import { D, moneyString } from '../utils/money.js';
import { toOid } from '../repositories/report.repository.js';
import { periodBounds } from './gstFiling.service.js';

export const EXPORT_MAX_ROWS = 10_000;
const MONEY_FIELDS = ['taxableAmount', 'cgst', 'sgst', 'igst', 'totalTax', 'grandTotal'];
const OPEN_ISSUE = [FILING_ISSUE_STATUS.OPEN, FILING_ISSUE_STATUS.IN_PROGRESS];

/** Decimal128 (MongoDB) or exact decimal string (fake) -> fixed 2dp string. Never floating point. */
export const money = (v) => moneyString(v === null || v === undefined ? '0' : String(v));
const addMoney = (...vals) => moneyString(vals.reduce((s, v) => s.plus(new D(String(v ?? 0))), new D(0)));
const zeroCounts = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const countsFrom = (rows, keys) => {
  const out = zeroCounts(keys);
  for (const r of rows) if (r._id !== null && r._id !== undefined) out[r._id] = (out[r._id] ?? 0) + r.count;
  return out;
};
const dateMatch = (range) => ({ $gte: range.from, $lte: range.to });
const assertEnum = (value, values, name) => {
  if (value !== undefined && !values.includes(value)) throw new ValidationError(`${name} must be one of ${values.join(', ')}`);
};
/** Every YYYY-MM key overlapping a resolved range (bounded: ranges are capped at ~2 years). */
const periodKeysIn = (range) => {
  const keys = [];
  let y = range.from.getUTCFullYear(); let m = range.from.getUTCMonth();
  const endKey = range.to.toISOString().slice(0, 7);
  for (;;) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    keys.push(key);
    if (key >= endKey) break;
    m += 1; if (m === 12) { m = 0; y += 1; }
  }
  return keys;
};

/**
 * Phase 9 — reusable tenant-scoped reporting layer.
 *
 * Every report is a declarative definition (row model, filters, server-side summary aggregation, row
 * decoration, CSV columns) executed by the same engine, against ReportRepository, with a scope that was
 * resolved server-side by the route's access middleware. Summaries/totals are ALWAYS computed by a
 * MongoDB aggregation over the full filtered set — never by summing the returned page. GST/money values are
 * read from the invoice's stored authoritative fields; nothing is recalculated here.
 */
export class ReportService {
  constructor({ reportRepo, auditService, gstFilingService, exportMaxRows = EXPORT_MAX_ROWS }) {
    Object.assign(this, { reportRepo, auditService, gstFilingService, exportMaxRows });
    this.definitions = this.#buildDefinitions();
  }

  // ======================================================================= shared metric queries
  /** Stored-total sums for invoices matching `extra` (e.g. ISSUED in a range). */
  async invoiceTotals(scope, extra) {
    const [row] = await this.reportRepo.aggregate('Invoice', scope, extra, [{
      $group: {
        _id: null, count: { $sum: 1 },
        ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, { $sum: `$${f}` }])),
      },
    }]);
    const out = { count: row?.count ?? 0 };
    for (const f of MONEY_FIELDS) out[f] = money(row?.[f]);
    out.totalGst = addMoney(out.cgst, out.sgst, out.igst);
    return out;
  }

  async countBy(name, scope, extra, field, keys) {
    const rows = await this.reportRepo.aggregate(name, scope, extra, [{ $group: { _id: `$${field}`, count: { $sum: 1 } } }]);
    return countsFrom(rows, keys);
  }

  /** Tally sync outcome (from Phase 6 TallySyncLog, read-only) for invoices matching `extra`. */
  async tallyBreakdown(scope, extra) {
    const rows = await this.reportRepo.aggregate('Invoice', scope, extra, [
      { $lookup: { from: this.reportRepo.collectionName('TallySyncLog'), localField: '_id', foreignField: 'invoiceId', as: 'sync' } },
      { $unwind: { path: '$sync', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$sync.status', count: { $sum: 1 } } },
    ]);
    const out = { total: 0, synced: 0, failed: 0, pending: 0 };
    for (const r of rows) {
      out.total += r.count;
      if (r._id === TALLY_SYNC_STATUS.SYNCED) out.synced += r.count;
      else if (r._id === TALLY_SYNC_STATUS.FAILED) out.failed += r.count;
      else out.pending += r.count; // no record yet, NOT_SYNCED, QUEUED, SYNCING, RETRYING
    }
    return out;
  }

  /** Phase-8-compatible reconciliation input ({issued, tally:{synced, failed, notSynced}}) via one aggregation. */
  async #filingReconciliation(tenantId, periodKey) {
    const { from, to } = periodBounds(periodKey);
    const rows = await this.reportRepo.aggregate('Invoice', { tenantIds: [String(tenantId)] }, { invoiceStatus: INVOICE_STATUS.ISSUED, invoiceDate: { $gte: from, $lte: to } }, [
      { $lookup: { from: this.reportRepo.collectionName('TallySyncLog'), localField: '_id', foreignField: 'invoiceId', as: 'sync' } },
      { $unwind: { path: '$sync', preserveNullAndEmptyArrays: true } },
      { $group: { _id: '$sync.status', count: { $sum: 1 } } },
    ]);
    const tally = { synced: 0, failed: 0, notSynced: 0 };
    let issued = 0;
    for (const r of rows) {
      issued += r.count;
      if (r._id === TALLY_SYNC_STATUS.SYNCED) tally.synced += r.count;
      else if (r._id === TALLY_SYNC_STATUS.FAILED) tally.failed += r.count;
      else tally.notSynced += r.count;
    }
    return { periodKey, issued, tally };
  }

  // ======================================================================= definitions
  #buildDefinitions() {
    const repo = this.reportRepo;
    return {
      'invoice-summary': {
        title: 'Invoice summary',
        permissions: ['invoices.view'],
        model: 'Invoice',
        defaultRange: 'this_month',
        sort: { invoiceDate: -1, invoiceNumber: -1 },
        filter: (q, range) => {
          assertEnum(q.status, Object.values(INVOICE_STATUS), 'status');
          return { ...(q.status ? { invoiceStatus: q.status } : {}), invoiceDate: dateMatch(range) };
        },
        summary: async (scope, match) => ({
          byStatus: await this.countBy('Invoice', scope, match, 'invoiceStatus', Object.values(INVOICE_STATUS)),
          totals: await this.invoiceTotals(scope, match),
          note: 'Totals cover every invoice matching the filters (all pages). Filter status=ISSUED for financial totals.',
        }),
        decorate: async (scope, rows) => {
          const syncs = rows.length ? await repo.find('TallySyncLog', scope, { invoiceId: { $in: rows.map((r) => toOid(r._id)) } }, { sort: { startedAt: -1 } }) : [];
          const byInvoice = new Map(syncs.map((s) => [String(s.invoiceId), s]));
          return rows.map((r) => ({
            _id: r._id, invoiceNumber: r.invoiceNumber, invoiceDate: r.invoiceDate,
            customerName: r.customerSnapshot?.businessName || r.customerSnapshot?.name || null, customerGstin: r.customerSnapshot?.gstin ?? null,
            invoiceStatus: r.invoiceStatus, gstApplicable: r.gstApplicable,
            ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, money(r[f])])),
            tallySyncStatus: byInvoice.get(String(r._id))?.status ?? TALLY_SYNC_STATUS.NOT_SYNCED,
          }));
        },
        columns: [
          ['invoiceNumber', 'Invoice number'], ['invoiceDate', 'Invoice date'], ['customerName', 'Customer'], ['customerGstin', 'Customer GSTIN'],
          ['invoiceStatus', 'Status'], ['taxableAmount', 'Taxable value'], ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'],
          ['totalTax', 'Total tax'], ['grandTotal', 'Grand total'], ['tallySyncStatus', 'Tally sync status'],
        ],
      },

      'gst-summary': {
        title: 'GST summary (ISSUED invoices)',
        permissions: ['invoices.view'],
        defaultRange: 'this_quarter',
        grouped: true,
        filter: (q, range) => ({ invoiceStatus: INVOICE_STATUS.ISSUED, invoiceDate: dateMatch(range) }),
        rows: async (scope, match) => {
          const rows = await repo.aggregate('Invoice', scope, match, [
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$invoiceDate' } },
                invoiceCount: { $sum: 1 },
                gstApplicableInvoiceCount: { $sum: { $cond: ['$gstApplicable', 1, 0] } },
                taxableAmount: { $sum: '$taxableAmount' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' },
              },
            },
            { $sort: { _id: 1 } },
          ]);
          return rows.map((r) => ({
            _id: r._id, period: r._id, invoiceCount: r.invoiceCount, gstApplicableInvoiceCount: r.gstApplicableInvoiceCount,
            taxableAmount: money(r.taxableAmount), cgst: money(r.cgst), sgst: money(r.sgst), igst: money(r.igst),
            totalGst: addMoney(r.cgst, r.sgst, r.igst),
          }));
        },
        summary: async (scope, match) => {
          const [t] = await repo.aggregate('Invoice', scope, match, [{
            $group: {
              _id: null, invoiceCount: { $sum: 1 }, gstApplicableInvoiceCount: { $sum: { $cond: ['$gstApplicable', 1, 0] } },
              taxableAmount: { $sum: '$taxableAmount' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' },
            },
          }]);
          return {
            totals: {
              invoiceCount: t?.invoiceCount ?? 0, gstApplicableInvoiceCount: t?.gstApplicableInvoiceCount ?? 0,
              taxableAmount: money(t?.taxableAmount), cgst: money(t?.cgst), sgst: money(t?.sgst), igst: money(t?.igst),
              totalGst: addMoney(t?.cgst, t?.sgst, t?.igst),
            },
            note: 'ISSUED invoices only; values are the invoices\' stored authoritative totals (not recalculated). Periods are UTC calendar months of invoiceDate.',
          };
        },
        columns: [
          ['period', 'Period'], ['invoiceCount', 'Invoices'], ['gstApplicableInvoiceCount', 'GST-applicable invoices'], ['taxableAmount', 'Taxable value'],
          ['cgst', 'CGST'], ['sgst', 'SGST'], ['igst', 'IGST'], ['totalGst', 'Total GST'],
        ],
      },

      'tally-sync': {
        title: 'Tally sync report',
        permissions: ['tally.view'],
        model: 'TallySyncLog',
        defaultRange: 'this_month',
        sort: { startedAt: -1 },
        filter: (q, range) => {
          assertEnum(q.status, Object.values(TALLY_SYNC_STATUS), 'status');
          return { ...(q.status ? { status: q.status } : {}), startedAt: dateMatch(range) };
        },
        summary: async (scope, match) => {
          const [byStatus, latest, reasons] = await Promise.all([
            this.countBy('TallySyncLog', scope, match, 'status', Object.values(TALLY_SYNC_STATUS)),
            repo.aggregate('TallySyncLog', scope, { ...match, status: TALLY_SYNC_STATUS.SYNCED }, [{ $group: { _id: null, latest: { $max: '$completedAt' } } }]),
            repo.aggregate('TallySyncLog', scope, { ...match, status: { $in: [TALLY_SYNC_STATUS.FAILED, TALLY_SYNC_STATUS.RETRYING] } }, [
              { $group: { _id: '$errorCode', count: { $sum: 1 }, lastSeenAt: { $max: '$completedAt' } } }, { $sort: { count: -1 } },
            ]),
          ]);
          return {
            byStatus,
            latestSuccessfulSyncAt: latest[0]?.latest ?? null,
            failureReasons: reasons.map((r) => ({ errorCode: r._id ?? 'UNKNOWN', count: r.count, lastSeenAt: r.lastSeenAt ?? null })),
            note: 'Read-only view of recorded sync attempts (date filter applies to attempt start time). Reports never trigger a sync.',
          };
        },
        decorate: async (scope, rows) => {
          const invoices = await repo.byIds('Invoice', scope, rows.map((r) => r.invoiceId));
          return rows.map((r) => ({
            _id: r._id, invoiceId: r.invoiceId, invoiceNumber: invoices.get(String(r.invoiceId))?.invoiceNumber ?? null,
            status: r.status, attempt: r.attempt, voucherNumber: r.voucherNumber ?? null, errorCode: r.errorCode ?? null,
            errorMessage: r.errorMessage ?? null, startedAt: r.startedAt ?? null, completedAt: r.completedAt ?? null,
          }));
        },
        columns: [
          ['invoiceNumber', 'Invoice number'], ['status', 'Sync status'], ['attempt', 'Attempt'], ['voucherNumber', 'Voucher number'],
          ['errorCode', 'Error code'], ['errorMessage', 'Error message'], ['startedAt', 'Started at'], ['completedAt', 'Completed at'],
        ],
      },

      'gst-filing-status': {
        title: 'GST filing status (ERP workflow tracker)',
        permissions: ['gst_filings.view'],
        model: 'GSTFiling',
        crossTenant: true,
        defaultRange: null, // all periods unless a range is given
        sort: { periodKey: -1, returnType: 1 },
        filter: (q, range) => {
          assertEnum(q.status, Object.values(FILING_STATUS), 'status');
          return {
            ...(q.status ? { status: q.status } : {}), ...(q.returnType ? { returnType: q.returnType } : {}),
            ...(range ? { periodKey: { $in: periodKeysIn(range) } } : {}),
          };
        },
        summary: async (scope, match) => ({
          byStatus: await this.countBy('GSTFiling', scope, match, 'status', Object.values(FILING_STATUS)),
          note: 'ERP-internal workflow tracker only — submission info is MANUALLY_RECORDED, never portal-verified; readiness is computed, not a filing guarantee.',
        }),
        decorate: async (scope, rows) => {
          if (!rows.length) return [];
          const ids = rows.map((r) => r._id);
          const [issues, tenants, vendors] = await Promise.all([
            repo.find('GSTFilingIssue', scope, { filingId: { $in: ids.map(toOid) } }, { sort: { createdAt: -1 } }),
            repo.tenantNames(rows.map((r) => r.tenantId)),
            repo.userNames(rows.map((r) => r.vendorUserId)),
          ]);
          const issuesByFiling = new Map();
          for (const i of issues) issuesByFiling.set(String(i.filingId), [...(issuesByFiling.get(String(i.filingId)) ?? []), i]);
          const reconCache = new Map();
          const out = [];
          for (const f of rows) {
            const key = `${f.tenantId}:${f.periodKey}`;
            if (!reconCache.has(key)) reconCache.set(key, await this.#filingReconciliation(f.tenantId, f.periodKey));
            const own = issuesByFiling.get(String(f._id)) ?? [];
            const readiness = this.gstFilingService._readiness(f, own, reconCache.get(key));
            out.push({
              _id: f._id, tenantId: f.tenantId, clientName: tenants.get(String(f.tenantId)) ?? null,
              periodKey: f.periodKey, returnType: f.returnType, status: f.status, progressPercent: f.progressPercent ?? 0,
              assignedVendor: f.vendorUserId ? (vendors.get(String(f.vendorUserId)) ?? null) : null,
              dueDate: f.dueDate ?? null, submittedAt: f.submittedAt ?? null, completedAt: f.completedAt ?? null,
              submissionInfo: {
                acknowledgementNumber: f.submissionInfo?.acknowledgementNumber ?? null, referenceNumber: f.submissionInfo?.referenceNumber ?? null,
                submittedAt: f.submissionInfo?.submittedAt ?? null, source: 'MANUALLY_RECORDED',
              },
              openIssues: own.filter((i) => OPEN_ISSUE.includes(i.status)).length,
              readiness: { ready: readiness.ready, blockers: readiness.blockers, label: readiness.label },
            });
          }
          return out;
        },
        columns: [
          ['clientName', 'Client'], ['periodKey', 'Period'], ['returnType', 'Return type'], ['status', 'Status'], ['progressPercent', 'Progress %'],
          ['assignedVendor', 'Assigned vendor'], ['openIssues', 'Open issues'],
          ['ready', 'Workflow ready (internal)', (r) => (r.readiness.ready ? 'YES' : 'NO')], ['blockers', 'Readiness blockers', (r) => r.readiness.blockers.join('; ')],
          ['acknowledgementNumber', 'Acknowledgement no. (manually recorded)', (r) => r.submissionInfo.acknowledgementNumber],
          ['submissionSource', 'Submission source', (r) => r.submissionInfo.source], ['submittedAt', 'Submitted at'], ['completedAt', 'Completed at'],
        ],
      },

      'gst-filing-issues': {
        title: 'GST filing issues',
        permissions: ['gst_filing_issues.view'],
        model: 'GSTFilingIssue',
        crossTenant: true,
        defaultRange: null,
        sort: { createdAt: -1 },
        filter: (q, range) => {
          assertEnum(q.status, Object.values(FILING_ISSUE_STATUS), 'status');
          return {
            ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}), ...(q.issueType ? { type: q.issueType } : {}),
            ...(range ? { createdAt: dateMatch(range) } : {}),
          };
        },
        summary: async (scope, match) => ({
          byStatus: await this.countBy('GSTFilingIssue', scope, match, 'status', Object.values(FILING_ISSUE_STATUS)),
          openBySeverity: await this.countBy('GSTFilingIssue', scope, { ...match, status: { $in: OPEN_ISSUE } }, 'severity', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
        }),
        decorate: async (scope, rows) => {
          const [filings, invoices, tenants] = await Promise.all([
            repo.byIds('GSTFiling', scope, rows.map((r) => r.filingId)),
            repo.byIds('Invoice', scope, rows.map((r) => r.invoiceId)),
            repo.tenantNames(rows.map((r) => r.tenantId)),
          ]);
          const vendors = await repo.userNames([...filings.values()].map((f) => f.vendorUserId));
          return rows.map((r) => {
            const f = filings.get(String(r.filingId));
            return {
              _id: r._id, tenantId: r.tenantId, clientName: tenants.get(String(r.tenantId)) ?? null,
              type: r.type, severity: r.severity, status: r.status, title: r.title,
              filingId: r.filingId, filingPeriod: f?.periodKey ?? null, filingReturnType: f?.returnType ?? null,
              invoiceId: r.invoiceId ?? null, invoiceNumber: r.invoiceId ? (invoices.get(String(r.invoiceId))?.invoiceNumber ?? null) : null,
              assignedVendor: f?.vendorUserId ? (vendors.get(String(f.vendorUserId)) ?? null) : null,
              createdAt: r.createdAt, resolvedAt: r.resolvedAt ?? null,
            };
          });
        },
        columns: [
          ['clientName', 'Client'], ['type', 'Type'], ['severity', 'Severity'], ['status', 'Status'], ['title', 'Title'], ['filingPeriod', 'Filing period'],
          ['filingReturnType', 'Return type'], ['invoiceNumber', 'Linked invoice'], ['assignedVendor', 'Assigned vendor'], ['createdAt', 'Created at'], ['resolvedAt', 'Resolved at'],
        ],
      },

      'customer-summary': {
        title: 'Customer summary',
        permissions: ['customers.view'],
        model: 'Customer',
        defaultRange: null,
        sort: { createdAt: -1 },
        filter: (q, range) => {
          assertEnum(q.status, Object.values(CUSTOMER_STATUS), 'status');
          return { ...(q.status ? { status: q.status } : {}), ...(range ? { createdAt: dateMatch(range) } : {}) };
        },
        summary: async (scope, match) => {
          const [byStatus, registration, trend] = await Promise.all([
            this.countBy('Customer', scope, match, 'status', Object.values(CUSTOMER_STATUS)),
            repo.aggregate('Customer', scope, match, [{ $group: { _id: { $cond: [{ $ifNull: ['$gstin', false] }, 'GST_REGISTERED', 'UNREGISTERED'] }, count: { $sum: 1 } } }]),
            repo.aggregate('Customer', scope, match, [{ $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
          ]);
          return {
            byStatus,
            byGstRegistration: countsFrom(registration, ['GST_REGISTERED', 'UNREGISTERED']),
            createdByMonth: trend.map((t) => ({ period: t._id, count: t.count })),
            note: 'GST registration is derived from whether a GSTIN is recorded on the customer. The Customer model has no customer-type field.',
          };
        },
        decorate: async (scope, rows) => {
          const stats = rows.length ? await repo.aggregate('Invoice', scope, { invoiceStatus: INVOICE_STATUS.ISSUED, customerId: { $in: rows.map((r) => toOid(r._id)) } }, [
            { $group: { _id: '$customerId', issuedInvoiceCount: { $sum: 1 }, issuedGrandTotal: { $sum: '$grandTotal' } } },
          ]) : [];
          const byCustomer = new Map(stats.map((s) => [String(s._id), s]));
          return rows.map((r) => ({
            _id: r._id, customerCode: r.customerCode, name: r.name, businessName: r.businessName ?? null, gstin: r.gstin ?? null,
            state: r.state ?? r.billingAddress?.state ?? null, status: r.status, createdAt: r.createdAt,
            issuedInvoiceCount: byCustomer.get(String(r._id))?.issuedInvoiceCount ?? 0,
            issuedGrandTotal: money(byCustomer.get(String(r._id))?.issuedGrandTotal),
          }));
        },
        columns: [
          ['customerCode', 'Customer code'], ['name', 'Name'], ['businessName', 'Business name'], ['gstin', 'GSTIN'], ['state', 'State'], ['status', 'Status'],
          ['issuedInvoiceCount', 'Issued invoices'], ['issuedGrandTotal', 'Issued grand total'], ['createdAt', 'Created at'],
        ],
      },
    };
  }

  // ======================================================================= engine
  definition(type) {
    const def = this.definitions[type];
    if (!def) throw new NotFoundError('Unknown report');
    return def;
  }

  /** Report types the given permission set may run (for the catalog endpoint / UI). */
  catalog(permissions, { crossTenantOnly = false } = {}) {
    return Object.entries(this.definitions)
      .filter(([, d]) => (!crossTenantOnly || d.crossTenant) && d.permissions.every((p) => permissions.has(p)))
      .map(([key, d]) => ({ key, title: d.title, permissions: d.permissions }));
  }

  #range(def, query) {
    const wantsRange = query.range || query.from || query.to;
    if (!wantsRange && !def.defaultRange) return null;
    return resolveDateRange(query, { defaultPreset: def.defaultRange ?? 'this_month' });
  }

  /** JSON report: paginated detail rows + server-side summary over the full filtered set. */
  async run(type, scope, query = {}) {
    const def = this.definition(type);
    const range = this.#range(def, query);
    const match = def.filter(query, range);
    const summary = await def.summary(scope, match);
    if (def.grouped) {
      const items = await def.rows(scope, match);
      return { report: type, title: def.title, range, summary, items, pagination: null };
    }
    const p = parsePagination(query);
    const [rows, total] = await Promise.all([
      this.reportRepo.find(def.model, scope, match, { sort: def.sort, skip: p.skip, limit: p.limit }),
      this.reportRepo.count(def.model, scope, match),
    ]);
    return {
      report: type, title: def.title, range, summary, items: await def.decorate(scope, rows), pagination: buildPageMeta(p, total),
    };
  }

  /**
   * SYNCHRONOUS CSV export (no background job system exists). The filtered row count is checked first; a
   * result larger than `exportMaxRows` is rejected with 422 EXPORT_ROW_LIMIT_EXCEEDED rather than silently
   * truncated. Every successful export is audited (DATA_EXPORT).
   */
  async exportCsv(ctx, type, scope, query = {}) {
    const def = this.definition(type);
    const range = this.#range(def, query);
    const match = def.filter(query, range);
    let rows;
    if (def.grouped) {
      rows = await def.rows(scope, match);
    } else {
      const total = await this.reportRepo.count(def.model, scope, match);
      if (total > this.exportMaxRows) {
        throw new AppError('EXPORT_ROW_LIMIT_EXCEEDED', `This export would contain ${total} rows; the synchronous export limit is ${this.exportMaxRows}. Narrow the date range or filters.`, 422, [{ rowCount: total, maxRows: this.exportMaxRows }]);
      }
      rows = await def.decorate(scope, await this.reportRepo.find(def.model, scope, match, { sort: def.sort, limit: this.exportMaxRows }));
    }
    const csv = toCsv(def.columns.map(([key, header, value]) => ({ key, header, value })), rows);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.DATA_EXPORT, resourceType: 'Report', resourceId: type,
      tenantId: scope.tenantIds?.length === 1 ? scope.tenantIds[0] : null,
      metadata: {
        report: type, format: 'CSV', rowCount: rows.length, crossTenant: Boolean(scope.allTenants),
        filters: { status: query.status, severity: query.severity, issueType: query.issueType, returnType: query.returnType },
        range: range ? { preset: range.preset, from: range.from, to: range.to } : null,
      },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return { csv, fileName: `${type}-${stamp}.csv`, rowCount: rows.length };
  }
}
