import {
  ConflictError, NotFoundError, ValidationError, AuthorizationError,
} from '../utils/errors.js';
import {
  AUDIT_ACTIONS, FILING_STATUS, FILING_MILESTONE_STATUS, FILING_ISSUE_STATUS, INVOICE_STATUS, TALLY_SYNC_STATUS,
} from '../constants/statuses.js';
import { ROLES } from '../constants/roles.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

/**
 * Phase 8 — GST filing WORKFLOW TRACKER (ERP-internal). See the GSTFiling model's doc comment for the full
 * scope boundary: this module never talks to a GST portal and never fabricates a government acknowledgement.
 */

const DEFAULT_MILESTONES = Object.freeze([
  { key: 'DATA_COLLECTION', label: 'Collect & verify invoice data', order: 1 },
  { key: 'RECONCILIATION', label: 'Reconcile against Tally sync records', order: 2 },
  { key: 'ISSUE_RESOLUTION', label: 'Resolve open issues', order: 3 },
  { key: 'REVIEW', label: 'Internal review complete', order: 4 },
  { key: 'SUBMISSION', label: 'Return submitted', order: 5 },
].map((m) => ({ ...m, status: FILING_MILESTONE_STATUS.PENDING })));

const periodParts = (periodKey) => {
  const [y, m] = periodKey.split('-').map(Number);
  return { year: y, month: m };
};

/** Indian financial year starting April: Jan-Mar belongs to the FY that started the previous calendar year. */
const financialYearFor = (year, month) => (month >= 4 ? `${year}-${String((year + 1) % 100).padStart(2, '0')}` : `${year - 1}-${String(year % 100).padStart(2, '0')}`);

export const periodBounds = (periodKey) => {
  const { year, month } = periodParts(periodKey);
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
};

const computeProgress = (milestones) => {
  if (!milestones?.length) return 0;
  const done = milestones.filter((m) => m.status === FILING_MILESTONE_STATUS.DONE).length;
  return Math.round((done / milestones.length) * 100);
};

const TRANSITIONS = {
  start: { from: FILING_STATUS.NOT_STARTED, to: FILING_STATUS.IN_PROGRESS, dateField: 'startedAt', action: AUDIT_ACTIONS.GST_FILING_STARTED },
  ready: { from: FILING_STATUS.IN_PROGRESS, to: FILING_STATUS.READY_FOR_REVIEW, dateField: null, action: AUDIT_ACTIONS.GST_FILING_READY },
  submit: { from: FILING_STATUS.READY_FOR_REVIEW, to: FILING_STATUS.SUBMITTED, dateField: 'submittedAt', action: AUDIT_ACTIONS.GST_FILING_SUBMITTED },
  markFiled: { from: FILING_STATUS.SUBMITTED, to: FILING_STATUS.FILED, dateField: 'completedAt', action: AUDIT_ACTIONS.GST_FILING_MARKED_FILED },
};

export class GSTFilingService {
  constructor({
    gstFilingRepo, gstFilingIssueRepo, tenantRepo, userRepo, assignmentRepo, invoiceRepo, tallySyncRepo, businessProfileRepo, auditService,
    notificationService = null,
  }) {
    Object.assign(this, {
      gstFilingRepo, gstFilingIssueRepo, tenantRepo, userRepo, assignmentRepo, invoiceRepo, tallySyncRepo, businessProfileRepo, auditService,
      notificationService,
    });
  }

  // ---- list (role-aware; cross-tenant only for MASTER_ADMIN / GST_VENDOR's own assigned clients) ----
  async list(authCtx, query) {
    const p = parsePagination(query);
    const filter = {};
    if (query.period) filter.periodKey = query.period;
    if (query.returnType) filter.returnType = query.returnType;
    if (query.status) filter.status = query.status;
    if (query.vendor) filter.vendorUserId = query.vendor;

    let tenantIds = null; // null = unrestricted (MASTER_ADMIN without a client filter / header)
    if (authCtx.role === ROLES.GST_VENDOR) {
      const assignments = await this.assignmentRepo.listActiveByVendor(authCtx.vendorId);
      const assigned = assignments.map((a) => String(a.tenantId));
      // Phase 18: same vendor "client workspace" narrowing as BillIntakeService — the requested client is
      // only honoured when it is one of the vendor's own ACTIVE assignments, never trusted bare.
      if (query.client) {
        if (!assigned.includes(String(query.client))) throw new AuthorizationError();
        tenantIds = [String(query.client)];
      } else {
        tenantIds = assigned;
      }
    } else if (authCtx.role === ROLES.CLIENT_ADMIN || authCtx.role === ROLES.CLIENT_USER) {
      tenantIds = [authCtx.tenantId];
    } else if (query.client) {
      tenantIds = [query.client];
    }
    if (tenantIds) filter.tenantId = { $in: tenantIds };

    const sort = parseSort(query.sort, ['periodKey', 'dueDate', 'createdAt', 'status']);
    const r = await this.gstFilingRepo.model.find(filter).sort(sort).skip(p.skip).limit(p.limit).lean();
    const total = await this.gstFilingRepo.model.countDocuments(filter);
    return { items: r.map((f) => ({ ...f, progressPercent: computeProgress(f.milestones) })), pagination: buildPageMeta(p, total) };
  }

  async get(ctx, filing) {
    const [issues, reconciliation] = await Promise.all([
      this.gstFilingIssueRepo.listByFiling(ctx.tenantId, filing._id),
      this.reconciliation(ctx.tenantId, filing),
    ]);
    const readiness = this._readiness(filing, issues, reconciliation);
    return {
      ...filing,
      progressPercent: computeProgress(filing.milestones),
      issueSummary: this._issueSummary(issues),
      reconciliation,
      readiness,
    };
  }

  /** Master Admin OR an actively-assigned GST Vendor may create a filing workflow for a tenant+period+returnType. */
  async create(ctx, dto) {
    const tenant = await this.tenantRepo.findById(dto.tenantId);
    if (!tenant || tenant.isDeleted || tenant.status !== 'ACTIVE') throw new ValidationError('Client must exist and be ACTIVE');

    if (dto.vendorUserId) {
      const vendorUser = await this.userRepo.findById(dto.vendorUserId);
      if (!vendorUser || vendorUser.role !== ROLES.GST_VENDOR) throw new ValidationError('vendorUserId must reference a GST vendor user');
      const assignment = await this.assignmentRepo.findActive(vendorUser.vendorId, dto.tenantId);
      if (!assignment) throw new ValidationError('The specified vendor does not have an active assignment to this client');
    }

    const existing = await this.gstFilingRepo.findOne(dto.tenantId, { periodKey: dto.periodKey, returnType: dto.returnType });
    if (existing) throw new ConflictError('A filing workflow for this client, period and return type already exists', 'FILING_ALREADY_EXISTS');

    const { year, month } = periodParts(dto.periodKey);
    const filing = await this.gstFilingRepo.create(dto.tenantId, {
      periodKey: dto.periodKey, returnType: dto.returnType, year, month,
      financialYear: financialYearFor(year, month), periodLabel: `${dto.periodKey} (${dto.returnType})`,
      vendorUserId: dto.vendorUserId ?? null, dueDate: dto.dueDate ?? null, notes: dto.notes,
      status: FILING_STATUS.NOT_STARTED, progressPercent: 0, milestones: DEFAULT_MILESTONES.map((m) => ({ ...m })),
      assignedAt: dto.vendorUserId ? new Date() : null, history: [],
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.GST_FILING_CREATED, resourceType: 'GSTFiling', resourceId: filing._id, tenantId: dto.tenantId, metadata: { periodKey: dto.periodKey, returnType: dto.returnType } });
    return filing;
  }

  /** Non-status-transition fields only: notes/dueDate/vendorUserId/milestones/submissionInfo. */
  async update(ctx, filing, patch) {
    const set = {};
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.vendorUserId !== undefined) {
      if (patch.vendorUserId) {
        const vendorUser = await this.userRepo.findById(patch.vendorUserId);
        if (!vendorUser || vendorUser.role !== ROLES.GST_VENDOR) throw new ValidationError('vendorUserId must reference a GST vendor user');
        const assignment = await this.assignmentRepo.findActive(vendorUser.vendorId, filing.tenantId);
        if (!assignment) throw new ValidationError('The specified vendor does not have an active assignment to this client');
        set.assignedAt = filing.assignedAt ?? new Date();
      }
      set.vendorUserId = patch.vendorUserId;
    }
    if (patch.milestones !== undefined) {
      set.milestones = patch.milestones.map((m) => ({
        ...m,
        completedAt: m.status === FILING_MILESTONE_STATUS.DONE ? new Date() : undefined,
        completedBy: m.status === FILING_MILESTONE_STATUS.DONE ? ctx.actor.id : undefined,
      }));
      set.progressPercent = computeProgress(set.milestones);
    }
    if (patch.submissionInfo !== undefined) {
      set.submissionInfo = {
        ...(filing.submissionInfo ?? {}), ...patch.submissionInfo, source: 'MANUALLY_RECORDED',
      };
    }
    set.updatedBy = ctx.actor.id;
    const updated = await this.gstFilingRepo.updateById(ctx.tenantId, filing._id, set, ctx.actor.id);
    if (!updated) throw new NotFoundError('GST filing not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.GST_FILING_UPDATED, resourceType: 'GSTFiling', resourceId: filing._id, metadata: { fields: Object.keys(patch) } });
    return updated;
  }

  /** Concurrency-safe explicit state transition: the FROM status is part of the atomic filter. */
  async transition(ctx, filing, name, note) {
    const t = TRANSITIONS[name];
    if (!t) throw new ValidationError('Unknown transition');
    if (filing.status !== t.from) throw new ConflictError(`Filing must be ${t.from} to perform this transition (currently ${filing.status})`, 'INVALID_FILING_TRANSITION');
    const historyEntry = { previousStatus: filing.status, newStatus: t.to, actor: ctx.actor.id, timestamp: new Date(), note };
    const patch = { status: t.to, updatedBy: ctx.actor.id, history: [...(filing.history ?? []), historyEntry] };
    if (t.dateField) patch[t.dateField] = historyEntry.timestamp;
    // Status precondition (`{ status: t.from }`) is part of the atomic findOneAndUpdate filter, so two
    // concurrent calls to the same transition can never both succeed (same pattern as Invoice/TallySync).
    const updated = await this.gstFilingRepo.conditionalUpdate(ctx.tenantId, filing._id, { status: t.from }, patch);
    if (!updated) throw new ConflictError(`Filing must be ${t.from} to perform this transition (currently a concurrent request may have already moved it)`, 'INVALID_FILING_TRANSITION');
    await this.auditService.record(ctx, {
      action: t.action, resourceType: 'GSTFiling', resourceId: filing._id, metadata: { previousStatus: t.from, newStatus: t.to },
    });
    // Phase 9: ready/submit/markFiled notify the tenant's CLIENT_ADMINs + the still-assigned vendor ('start' does not notify).
    await this.notificationService?.filingTransitioned(updated, name);
    return updated;
  }

  // ---- issues ----
  async listIssues(tenantId, filingId) { return this.gstFilingIssueRepo.listByFiling(tenantId, filingId); }

  async createIssue(ctx, filing, dto) {
    if (dto.invoiceId) {
      const invoice = await this.invoiceRepo.findOneById(ctx.tenantId, dto.invoiceId);
      if (!invoice) throw new ValidationError('invoiceId must reference an invoice belonging to this client');
    }
    const issue = await this.gstFilingIssueRepo.create(ctx.tenantId, {
      filingId: String(filing._id), invoiceId: dto.invoiceId ?? null, type: dto.type, severity: dto.severity ?? 'MEDIUM',
      title: dto.title, description: dto.description, assignedTo: dto.assignedTo ?? null, status: 'OPEN', raisedBy: ctx.actor.id,
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.GST_FILING_ISSUE_CREATED, resourceType: 'GSTFilingIssue', resourceId: issue._id, metadata: { filingId: filing._id, type: dto.type, severity: issue.severity } });
    await this.notificationService?.filingIssueOpened(filing, issue);
    return issue;
  }

  async updateIssue(ctx, filing, issueId, patch) {
    const issue = await this.gstFilingIssueRepo.findOneForFiling(ctx.tenantId, filing._id, issueId);
    if (!issue) throw new NotFoundError('Issue not found for this filing');
    const set = { ...patch };
    if (patch.status === FILING_ISSUE_STATUS.RESOLVED) { set.resolvedBy = ctx.actor.id; set.resolvedAt = new Date(); }
    set.updatedBy = ctx.actor.id;
    const updated = await this.gstFilingIssueRepo.updateById(ctx.tenantId, issueId, set, ctx.actor.id);
    const action = patch.status === FILING_ISSUE_STATUS.RESOLVED
      ? AUDIT_ACTIONS.GST_FILING_ISSUE_RESOLVED
      : (patch.status === FILING_ISSUE_STATUS.CLOSED ? AUDIT_ACTIONS.GST_FILING_ISSUE_CLOSED : AUDIT_ACTIONS.GST_FILING_ISSUE_UPDATED);
    await this.auditService.record(ctx, { action, resourceType: 'GSTFilingIssue', resourceId: issueId, metadata: { filingId: filing._id, fields: Object.keys(patch) } });
    // Phase 9: only a real transition INTO RESOLVED notifies (a repeated RESOLVED patch is a no-op for notifications).
    if (patch.status === FILING_ISSUE_STATUS.RESOLVED && issue.status !== FILING_ISSUE_STATUS.RESOLVED && updated) {
      await this.notificationService?.filingIssueResolved(filing, updated);
    }
    return updated;
  }

  // ---- reconciliation (read-only: Phase 4 invoices + Phase 6 TallySync; never recomputed/re-triggered) ----
  async reconciliation(tenantId, filing) {
    const { from, to } = periodBounds(filing.periodKey);
    const invoices = await this.invoiceRepo.findAllInDateRange(tenantId, from, to);
    const issued = invoices.filter((i) => i.invoiceStatus === INVOICE_STATUS.ISSUED);
    const cancelled = invoices.filter((i) => i.invoiceStatus === INVOICE_STATUS.CANCELLED);
    const draftExcluded = invoices.filter((i) => i.invoiceStatus === INVOICE_STATUS.DRAFT);

    const syncRecords = await Promise.all(issued.map((inv) => this.tallySyncRepo.findByInvoice(tenantId, inv._id)));
    const tally = { synced: 0, failed: 0, notSynced: 0 };
    syncRecords.forEach((rec) => {
      if (rec?.status === TALLY_SYNC_STATUS.SYNCED) tally.synced += 1;
      else if (rec?.status === TALLY_SYNC_STATUS.FAILED) tally.failed += 1;
      else tally.notSynced += 1;
    });

    return {
      periodKey: filing.periodKey,
      total: invoices.length,
      issued: issued.length,
      cancelled: cancelled.length,
      draftExcluded: draftExcluded.length,
      tally,
    };
  }

  _issueSummary(issues) {
    const open = issues.filter((i) => i.status === FILING_ISSUE_STATUS.OPEN || i.status === FILING_ISSUE_STATUS.IN_PROGRESS);
    const critical = open.filter((i) => i.severity === 'CRITICAL');
    return { total: issues.length, open: open.length, resolved: issues.length - open.length, critical: critical.length };
  }

  /**
   * READINESS = an ERP WORKFLOW indicator only ("is this filing's own tracked data in good shape"), computed
   * strictly from already-stored invoice/Tally-sync/issue data. It is NEVER a government filing guarantee —
   * there is no portal integration backing this, and the wording below must never imply one.
   */
  _readiness(filing, issues, reconciliation) {
    const blockers = [];
    const openIssues = issues.filter((i) => i.status === FILING_ISSUE_STATUS.OPEN || i.status === FILING_ISSUE_STATUS.IN_PROGRESS);
    const criticalOpen = openIssues.filter((i) => i.severity === 'CRITICAL');
    if (reconciliation.issued === 0) blockers.push('No ISSUED invoices recorded for this period');
    if (criticalOpen.length) blockers.push(`${criticalOpen.length} open critical issue(s)`);
    if (openIssues.length) blockers.push(`${openIssues.length} open issue(s) overall`);
    const unsynced = reconciliation.tally.notSynced + reconciliation.tally.failed;
    if (unsynced > 0) blockers.push(`${unsynced} issued invoice(s) not Tally-synced`);
    return {
      ready: blockers.length === 0,
      blockers,
      label: 'ERP workflow readiness (internal tracker only) — not a government filing guarantee',
    };
  }
}
