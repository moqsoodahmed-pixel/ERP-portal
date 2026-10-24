import crypto from 'node:crypto';
import {
  ConflictError, NotFoundError, ValidationError, AuthorizationError,
} from '../utils/errors.js';
import { AUDIT_ACTIONS, BILL_STATUS as S, BILL_TALLY_STATUS as TS } from '../constants/statuses.js';
import { ROLES } from '../constants/roles.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';
import { ALLOWED_BILL_MIME_TYPES, MAX_BILL_FILE_BYTES } from '../validators/billIntake.validators.js';
import { generateBillId, getFinancialYearString } from '../utils/billIdentifier.js';

/**
 * Phase 15 — CLIENT BILL INTAKE + TALLY QUEUE (ERP-internal workflow; see the spec's Step 2 scope boundary:
 * this NEVER silently turns a client-uploaded bill into an official ERP Invoice, and NEVER talks to a real
 * Tally instance — that remains a future Windows Tally Connector phase).
 *
 * Every state transition goes through `transition()`, which guards the change with a concurrency-safe
 * atomic update (the current status is part of the findOneAndUpdate filter — same pattern as
 * GSTFilingService/InvoiceRepository), so two simultaneous review/reject/queue actions on the same bill can
 * never both succeed (spec Step 18). There is no generic PATCH-the-status path anywhere in this module.
 */

const DRAFT_EDITABLE_FIELDS = ['billNumber', 'billDate', 'vendorName', 'vendorGSTIN', 'amount', 'taxableAmount', 'cgst', 'sgst', 'igst', 'notes'];

const TRANSITIONS = {
  submit: { from: [S.DRAFT], to: S.SUBMITTED, dateField: 'submittedAt', actorField: 'submittedBy', action: AUDIT_ACTIONS.BILL_SUBMITTED },
  startReview: { from: [S.SUBMITTED], to: S.UNDER_REVIEW, dateField: null, action: AUDIT_ACTIONS.BILL_REVIEW_STARTED },
  reject: { from: [S.SUBMITTED, S.UNDER_REVIEW], to: S.REJECTED, dateField: 'reviewedAt', actorField: 'reviewedBy', action: AUDIT_ACTIONS.BILL_REJECTED },
  approve: { from: [S.UNDER_REVIEW], to: S.READY_FOR_TALLY, dateField: 'readyForTallyAt', actorField: 'reviewedBy', action: AUDIT_ACTIONS.BILL_READY_FOR_TALLY },
  markNotReady: { from: [S.UNDER_REVIEW], to: S.FAILED, dateField: 'reviewedAt', actorField: 'reviewedBy', action: AUDIT_ACTIONS.BILL_FAILED },
  complete: { from: [S.ACCOUNTING_IN_PROGRESS], to: S.COMPLETED, dateField: 'completedAt', action: AUDIT_ACTIONS.BILL_COMPLETED },
};

export class BillIntakeService {
  constructor({
    billRepo, fileMetadataRepo, storageService, userRepo, assignmentRepo, tenantRepo, auditService, notificationService = null,
    // Phase 16: optional hook invoked with (ctx, bill) exactly once a bill enters the Tally Queue. Injected
    // rather than imported, so BillIntakeService has zero compile-time dependency on the Tally Connector
    // bridge — Phase 15's own tests/behaviour are unchanged when this is left undefined (the default).
    tallyJobHook = null,
    counterRepo = null,
    tallyBillSyncService = null,
  }) {
    Object.assign(this, {
      billRepo, fileMetadataRepo, storageService, userRepo, assignmentRepo, tenantRepo, auditService, notificationService, tallyJobHook,
      counterRepo, tallyBillSyncService,
    });
  }

  // ---------------------------------------------------------------- tenant-set resolution (role-aware; mirrors GSTFilingService.list)
  async #tenantIdsFor(authCtx, { client } = {}) {
    if (authCtx.role === ROLES.GST_VENDOR) {
      const assignments = await this.assignmentRepo.listActiveByVendor(authCtx.vendorId);
      const assigned = assignments.map((a) => String(a.tenantId));
      // Phase 18: a vendor may narrow to ONE of their own actively-assigned clients (the "client
      // workspace" view) — but the requested id is always checked against the vendor's own assignment
      // set server-side; it is never trusted bare, so a vendor can never pivot into another tenant's data.
      if (client) {
        if (!assigned.includes(String(client))) throw new AuthorizationError();
        return [String(client)];
      }
      return assigned;
    }
    if (authCtx.role === ROLES.CLIENT_ADMIN || authCtx.role === ROLES.CLIENT_USER) return [authCtx.tenantId];
    if (authCtx.role === ROLES.MASTER_ADMIN) return client ? [client] : null; // null = platform-wide
    throw new AuthorizationError();
  }

  async list(authCtx, query) {
    const p = parsePagination(query);
    const tenantIds = await this.#tenantIdsFor(authCtx, { client: query.client });
    const filter = {};
    if (tenantIds) filter.tenantId = { $in: tenantIds };
    if (query.status) filter.status = query.status;
    if (query.tallyStatus) filter.tallyStatus = query.tallyStatus;
    const sort = parseSort(query.sort, ['billDate', 'createdAt', 'status', 'billNumber']);
    const [items, total] = await Promise.all([
      this.billRepo.model.find(filter).sort(sort).skip(p.skip).limit(p.limit).lean(),
      this.billRepo.model.countDocuments(filter),
    ]);
    return { items, pagination: buildPageMeta(p, total) };
  }

  async get(ctx, bill) {
    const documents = bill.documentIds?.length ? await this.fileMetadataRepo.findManyForTenant(ctx.tenantId, bill.documentIds) : [];
    return {
      ...bill,
      documents: documents.map((d) => ({
        id: d._id, fileName: d.fileName, mimeType: d.mimeType, size: d.size, uploadedAt: d.createdAt,
      })),
      tallyReadiness: this.assessTallyReadiness(bill, documents),
    };
  }

  /** Server-side Tally-queue preparedness check (spec Step 13) — never fabricates missing values, only reports what's absent. */
  assessTallyReadiness(bill, documents) {
    const issues = [];
    if (!bill.billNumber) issues.push('Missing bill number');
    if (!bill.billDate) issues.push('Missing bill date');
    if (!bill.vendorName) issues.push('Missing vendor name');
    if (bill.amount === undefined || bill.amount === null) issues.push('Missing bill amount');
    if (!documents?.length && !bill.documentIds?.length) issues.push('No bill document uploaded');
    return { ready: issues.length === 0, issues };
  }

  // ---------------------------------------------------------------- create / draft update
  async create(ctx, dto) {
    let companyCode = dto.companyCode;
    let tenant = null;
    if (this.tenantRepo && ctx.tenantId) {
      tenant = await this.tenantRepo.findById(ctx.tenantId);
      if (tenant) {
        companyCode = companyCode || tenant.companyCode || tenant.tenantCode || 'CMP001';
      }
    }
    companyCode = companyCode || 'CMP001';

    let billId = dto.billId;
    if (!billId && this.counterRepo && ctx.tenantId) {
      billId = await generateBillId(this.counterRepo, ctx.tenantId, companyCode, dto.billDate || new Date());
    }

    // Duplicate Prevention before saving
    const invoiceNum = dto.billNumber || dto.invoiceNumber;
    if (this.tallyBillSyncService?.tallyBillSyncRepo?.checkDuplicate && invoiceNum) {
      const fy = getFinancialYearString(dto.billDate || new Date());
      const duplicate = await this.tallyBillSyncService.tallyBillSyncRepo.checkDuplicate({
        companyCode,
        invoiceNumber: invoiceNum,
        financialYear: fy,
        gstin: dto.supplierGstin || dto.vendorGSTIN,
        amount: dto.amount,
      });
      if (duplicate) {
        throw new ConflictError(
          `Duplicate bill detected: Invoice ${invoiceNum} is already queued or synchronized for company ${companyCode}`,
          'DUPLICATE_BILL_SYNC',
        );
      }
    }

    const bill = await this.billRepo.create(ctx.tenantId, {
      ...dto,
      billId,
      companyCode,
      clientUserId: ctx.actor.id,
      status: S.DRAFT,
      tallyStatus: TS.NOT_READY,
      documentIds: [],
      history: [],
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BILL_CREATED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { billId, companyCode } });

    // Step 6 & 7: Notify Master Admin and Assigned Assistant Admin
    if (this.notificationService?.billUploaded) {
      await this.notificationService.billUploaded(bill, companyCode).catch(() => {});
    }

    // Step 8: Add bill to Tally Sync Queue
    if (this.tallyBillSyncService?.enqueueBill && !dto.skipTallyQueue) {
      await this.tallyBillSyncService.enqueueBill({
        bill,
        tenant: tenant || { _id: ctx.tenantId, companyCode },
        user: ctx.actor,
        requestId: ctx.requestId,
        autoSync: true,
        priority: dto.priority,
      }).catch(() => {});
    }

    return bill;
  }

  /** DRAFT-editable fields only (spec Step 4/11): a submitted/under-review/etc bill can never be silently edited here. */
  async update(ctx, bill, patch) {
    if (bill.status !== S.DRAFT) throw new ConflictError('Only a DRAFT bill can be edited', 'BILL_NOT_DRAFT');
    const set = Object.fromEntries(Object.entries(patch).filter(([k]) => DRAFT_EDITABLE_FIELDS.includes(k)));
    set.updatedBy = ctx.actor.id;
    const updated = await this.billRepo.conditionalUpdate(ctx.tenantId, bill._id, { status: S.DRAFT }, set);
    if (!updated) throw new ConflictError('Bill is no longer a draft (a concurrent request may have already submitted it)', 'BILL_NOT_DRAFT');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BILL_UPDATED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { fields: Object.keys(set) } });
    return updated;
  }

  // ---------------------------------------------------------------- documents (reuses Phase 5 FileMetadata + StorageService)
  async addDocuments(ctx, bill, files) {
    if (bill.status !== S.DRAFT) throw new ConflictError('Documents can only be added to a DRAFT bill', 'BILL_NOT_DRAFT');
    const created = [];
    for (const f of files) {
      const buffer = Buffer.from(f.contentBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_BILL_FILE_BYTES) throw new ValidationError('Each document must be between 1 byte and 5MB');
      if (!ALLOWED_BILL_MIME_TYPES.includes(f.mimeType)) throw new ValidationError('Unsupported document type');
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileId = crypto.randomUUID();
      // Unguessable, server-derived key (tenant + random id) — never built from the client-supplied fileName.
      const storageKey = `tenant/${ctx.tenantId}/bills/${bill._id}/${fileId}`;
      await this.storageService.save(storageKey, buffer);
      try {
        const doc = await this.fileMetadataRepo.createForTenant(ctx.tenantId, {
          uploadedBy: ctx.actor.id, fileName: String(f.fileName).slice(0, 255), mimeType: f.mimeType, size: buffer.length,
          storageProvider: 'LOCAL_DEV', storageKey, checksum, purpose: 'BILL_DOCUMENT', entityType: 'BILL_INTAKE', entityId: String(bill._id),
        });
        created.push(doc);
      } catch (err) {
        await this.storageService.delete(storageKey).catch(() => {});
        throw err;
      }
    }
    const documentIds = [...(bill.documentIds ?? []), ...created.map((d) => String(d._id))];
    const updated = await this.billRepo.conditionalUpdate(ctx.tenantId, bill._id, { status: S.DRAFT }, { documentIds, updatedBy: ctx.actor.id });
    if (!updated) throw new ConflictError('Bill is no longer a draft', 'BILL_NOT_DRAFT');
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.BILL_DOCUMENT_UPLOADED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { count: created.length },
    });
    return updated;
  }

  /** Streams a bill document's bytes. IDOR guard: the document must both belong to this tenant AND be referenced by this exact bill. */
  async getDocument(ctx, bill, docId) {
    if (!bill.documentIds?.map(String).includes(String(docId))) throw new NotFoundError('Document not found on this bill');
    const doc = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, docId);
    if (!doc) throw new NotFoundError('Document not found');
    const buffer = await this.storageService.read(doc.storageKey);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BILL_DOCUMENT_ACCESSED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { documentId: docId } });
    return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  // ---------------------------------------------------------------- status machine
  async #transition(ctx, bill, name, { note, extraPatch = {} } = {}) {
    const t = TRANSITIONS[name];
    if (!t) throw new ValidationError('Unknown transition');
    if (!t.from.includes(bill.status)) {
      throw new ConflictError(`Bill must be one of [${t.from.join(', ')}] to perform this action (currently ${bill.status})`, 'INVALID_BILL_TRANSITION');
    }
    const historyEntry = { previousStatus: bill.status, newStatus: t.to, actor: ctx.actor.id, timestamp: new Date(), note };
    const patch = { status: t.to, updatedBy: ctx.actor.id, history: [...(bill.history ?? []), historyEntry], ...extraPatch };
    if (t.dateField) patch[t.dateField] = historyEntry.timestamp;
    if (t.actorField) patch[t.actorField] = ctx.actor.id;
    // Status precondition is part of the atomic filter: two concurrent calls to the same transition can
    // never both succeed (spec Step 18) — the loser gets a 409 ConflictError instead of corrupting state.
    const updated = await this.billRepo.conditionalUpdate(ctx.tenantId, bill._id, { status: bill.status }, patch);
    if (!updated) throw new ConflictError('A concurrent request already changed this bill\'s status', 'INVALID_BILL_TRANSITION');
    await this.auditService.record(ctx, { action: t.action, resourceType: 'BillIntake', resourceId: bill._id, metadata: { previousStatus: bill.status, newStatus: t.to } });
    return updated;
  }

  async submit(ctx, bill, note) {
    if (!bill.documentIds?.length) throw new ValidationError('At least one document must be uploaded before submitting a bill');
    const updated = await this.#transition(ctx, bill, 'submit', { note });
    await this.notificationService?.billSubmitted(updated);
    return updated;
  }

  /** Admin (Master Admin — this platform's only admin-capable role) opens a submitted bill for review. */
  async startReview(ctx, bill, note) {
    return this.#transition(ctx, bill, 'startReview', { note });
  }

  /**
   * Admin accepts a bill: moves it to UNDER_REVIEW (if not already) then runs the Tally-readiness check
   * (Step 13). If ready, the bill becomes READY_FOR_TALLY and enters the Tally Queue (tallyStatus
   * NOT_READY->QUEUED, audited separately as TALLY_QUEUE_CREATED). If not ready, the bill moves to FAILED
   * with the documented reasons — it is NEVER silently forced through with fabricated data.
   */
  async review(ctx, bill, note) {
    let current = bill;
    if (current.status === S.SUBMITTED) current = await this.startReview(ctx, current, note);
    const documents = current.documentIds?.length ? await this.fileMetadataRepo.findManyForTenant(ctx.tenantId, current.documentIds) : [];
    const readiness = this.assessTallyReadiness(current, documents);
    if (!readiness.ready) {
      const failed = await this.#transition(ctx, current, 'markNotReady', { note, extraPatch: { tallyReadinessIssues: readiness.issues } });
      return failed;
    }
    const approved = await this.#transition(ctx, current, 'approve', { note, extraPatch: { tallyReadinessIssues: [] } });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_QUEUE_CREATED, resourceType: 'BillIntake', resourceId: approved._id, metadata: {} });
    // Enter the Tally Queue: NOT_READY -> QUEUED, guarded the same way as the status transition above.
    const queued = await this.billRepo.conditionalUpdate(ctx.tenantId, approved._id, { tallyStatus: TS.NOT_READY }, { tallyStatus: TS.QUEUED, queuedAt: new Date() });
    const result = queued ?? approved;
    await this.notificationService?.billReadyForTally(result);
    // Phase 16: exactly one TallyJob per bill (spec Step 10) — createForBill() is itself idempotent, so a
    // retried review request / concurrent approval can call this hook more than once safely.
    await this.tallyJobHook?.(ctx, result);
    return result;
  }

  async reject(ctx, bill, reason) {
    const updated = await this.#transition(ctx, bill, 'reject', { note: reason, extraPatch: { rejectionReason: reason } });
    await this.notificationService?.billRejected(updated);
    return updated;
  }

  // ---------------------------------------------------------------- Tally Queue (bridge to the future Tally Connector; no real Tally call happens here)
  async queue(authCtx, query) {
    const p = parsePagination(query);
    const tenantIds = await this.#tenantIdsFor(authCtx, { client: query.clientId });
    const r = await this.billRepo.findQueue({ tenantIds, tallyStatus: query.tallyStatus, page: p.page, limit: p.limit, skip: p.skip });
    return {
      items: r.items.map((b) => ({
        id: b._id, tenantId: b.tenantId, billNumber: b.billNumber, billDate: b.billDate, amount: b.amount,
        documentIds: b.documentIds, status: b.status, tallyStatus: b.tallyStatus, createdAt: b.createdAt,
        readyAt: b.readyForTallyAt, lastSyncAttemptAt: b.lastSyncAttemptAt, failureReason: b.tallyFailureReason,
        retryAvailable: b.tallyStatus === TS.FAILED,
      })),
      pagination: buildPageMeta(p, r.total),
    };
  }

  /** Vendor marks a queued bill as being actively worked in Tally. Manual status update only — no real connector exists yet. */
  async tallyProcessingStarted(ctx, bill) {
    const updated = await this.billRepo.conditionalUpdate(ctx.tenantId, bill._id, { tallyStatus: TS.QUEUED }, { tallyStatus: TS.PROCESSING, lastSyncAttemptAt: new Date() });
    if (!updated) throw new ConflictError('Bill must be QUEUED to start Tally processing', 'INVALID_TALLY_TRANSITION');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_PROCESSING_STARTED, resourceType: 'BillIntake', resourceId: bill._id, metadata: {} });
    await this.notificationService?.tallyProcessing(updated);
    return updated;
  }

  async tallySynced(ctx, bill, tallyReference) {
    const updated = await this.billRepo.conditionalUpdate(
      ctx.tenantId, bill._id, { tallyStatus: TS.PROCESSING },
      { tallyStatus: TS.SYNCED, tallyReference, status: S.ACCOUNTING_IN_PROGRESS, updatedBy: ctx.actor.id },
    );
    if (!updated) throw new ConflictError('Bill must be PROCESSING to record a Tally sync result', 'INVALID_TALLY_TRANSITION');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_PROCESSING_SUCCEEDED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { tallyReference } });
    return updated;
  }

  async tallyFailed(ctx, bill, reason) {
    const updated = await this.billRepo.conditionalUpdate(
      ctx.tenantId, bill._id, { tallyStatus: { $in: [TS.QUEUED, TS.PROCESSING] } },
      { tallyStatus: TS.FAILED, tallyFailureReason: reason, updatedBy: ctx.actor.id },
    );
    if (!updated) throw new ConflictError('Bill must be QUEUED or PROCESSING to record a Tally failure', 'INVALID_TALLY_TRANSITION');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_PROCESSING_FAILED, resourceType: 'BillIntake', resourceId: bill._id, metadata: { reason } });
    await this.notificationService?.tallyFailed(updated);
    return updated;
  }

  async tallyRetry(ctx, bill) {
    const updated = await this.billRepo.conditionalUpdate(ctx.tenantId, bill._id, { tallyStatus: TS.FAILED }, { tallyStatus: TS.QUEUED, tallyFailureReason: null, updatedBy: ctx.actor.id });
    if (!updated) throw new ConflictError('Bill must be FAILED to retry', 'INVALID_TALLY_TRANSITION');
    return updated;
  }

  async complete(ctx, bill) {
    const updated = await this.#transition(ctx, bill, 'complete', {});
    await this.notificationService?.billCompleted(updated);
    return updated;
  }
}
