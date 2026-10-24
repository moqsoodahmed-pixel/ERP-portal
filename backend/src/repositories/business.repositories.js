import { TenantRepository } from './tenant.repository.js';
import { isObjectId } from '../utils/objectId.js';
import { TALLY_CONNECTOR_STATUS } from '../constants/statuses.js';

export class ProductRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['productName', 'productCode', 'hsnSacCode'] }); }
  findManyByIds(tenantId, ids) { return this.model.find(this.scope(tenantId, { _id: { $in: ids.map(String) } })).lean(); }
}
export class CustomerRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['name', 'businessName', 'customerCode', 'gstin', 'email'] }); }
}
/** One profile per tenant (tenantId has a unique index on the schema). */
export class BusinessProfileRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
  findByTenant(tenantId) { return this.findOne(tenantId, {}); }
}
export class InvoiceRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['invoiceNumber'], dateField: 'invoiceDate' }); }

  /**
   * Status-guarded update: the `invoiceStatus` precondition is part of the atomic findOneAndUpdate filter,
   * so a concurrent transition (double-issue / double-cancel) loses the race instead of corrupting state.
   * Returns null when the precondition no longer holds (already transitioned by another request).
   */
  async conditionalUpdate(tenantId, id, matchExtra, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }

  /**
   * Unpaginated fetch of every invoice (any status) whose authoritative `invoiceDate` falls within [from, to]
   * (inclusive). Used ONLY for internal aggregation (Phase 8 GST filing reconciliation) — never exposed
   * directly as a paginated list endpoint, so PAGINATION.MAX_LIMIT does not apply here.
   */
  findAllInDateRange(tenantId, from, to) {
    return this.model.find(this.scope(tenantId, { invoiceDate: { $gte: from, $lte: to } })).lean();
  }
}
/**
 * Phase 22 — Credit/Debit Notes. `conditionalUpdate` guards the only mutation a note ever undergoes
 * (ISSUED -> CANCELLED) with the current status as part of the atomic filter, same pattern as
 * InvoiceRepository — a concurrent double-cancel loses the race instead of double-firing side effects.
 */
export class CreditDebitNoteRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['noteNumber', 'invoiceNumber'], dateField: 'noteDate' }); }

  findByInvoice(tenantId, invoiceId) { return this.model.find(this.scope(tenantId, { invoiceId: String(invoiceId) })).sort({ createdAt: -1 }).lean(); }

  async conditionalUpdate(tenantId, id, matchExtra, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }
}

/** Generic tenant-scoped repository for append-style tenant collections (sync logs, filings, history). */
export class SimpleTenantRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
}

/**
 * Phase 13 Tally Public API keys. `findByHash` is deliberately NOT tenant-scoped — authenticating an
 * inbound request is exactly how the tenant gets resolved in the first place (see
 * middlewares/tallyApiAuth.js); every other method goes through the normal tenant-scoped TenantRepository
 * methods once a tenant context exists.
 */
export class TallyApiKeyRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  findByHash(keyHash) { return this.model.findOne({ keyHash }).lean(); }

  listByTenant(tenantId) { return this.model.find(this.scope(tenantId)).sort({ createdAt: -1 }).lean(); }

  /** Throttled last-used write: only touches the document if it's stale, so every authenticated request doesn't become a write. */
  touchLastUsed(id, { staleAfterMs = 5 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - staleAfterMs);
    return this.model.updateMany(
      { _id: String(id), $or: [{ lastUsedAt: { $exists: false } }, { lastUsedAt: { $lt: cutoff } }] },
      { $set: { lastUsedAt: new Date() } },
    );
  }

  /** Atomic ACTIVE->EXPIRED flip, guarded so a concurrent request fires at most one TALLY_API_KEY_EXPIRED audit event. */
  markExpired(id) {
    return this.model.findOneAndUpdate({ _id: String(id), status: 'ACTIVE' }, { $set: { status: 'EXPIRED' } }, { returnDocument: 'after' }).lean();
  }

  async findByIntegrationId(integrationId) {
    if (!integrationId) return null;
    return this.model.findOne({ integrationId }).lean();
  }

  async listAll(filter = {}) {
    return this.model.find(filter).sort({ createdAt: -1 }).lean();
  }

  async listByTenantIds(tenantIds = [], filter = {}) {
    const ids = Array.isArray(tenantIds) ? tenantIds.map(String) : [String(tenantIds)];
    return this.model.find({ tenantId: { $in: ids }, ...filter }).sort({ createdAt: -1 }).lean();
  }

  async deleteById(tenantId, id) {
    const q = { _id: String(id) };
    if (tenantId) q.tenantId = String(tenantId);
    if (typeof this.model.deleteOne === 'function') {
      return this.model.deleteOne(q);
    }
    return this.model.findOneAndDelete(q).lean();
  }
}

/** One TallyIntegration document per tenant (tenantId has a unique index on the schema). */
export class TallyIntegrationRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
  findByTenant(tenantId) { return this.findOne(tenantId, {}); }

  /** Fetches the config WITH the encrypted secret field included (select:false by default). Internal use only. */
  findByTenantWithSecret(tenantId) {
    if (!isObjectId(tenantId)) return null;
    return this.model.findOne(this.scope(tenantId)).select('+authPasswordEncrypted').lean();
  }

  /** Create-or-update-in-place: one config per tenant, enforced by the unique tenantId index. */
  async upsert(tenantId, patch, actorId) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !['_id', 'tenantId', 'createdAt'].includes(k)));
    if (actorId) clean.updatedBy = actorId;
    return this.model.findOneAndUpdate(
      this.scope(tenantId),
      { $set: clean, $setOnInsert: { tenantId: String(tenantId), createdBy: actorId } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
  }
}

/**
 * Sync-tracking records. The unique (tenantId, invoiceId) index is the idempotency guard: `startSync`
 * uses an atomic findOneAndUpdate with a status precondition (the same conditional-update pattern
 * InvoiceRepository uses for issue/cancel) so two concurrent sync requests for the same invoice cannot
 * both win and both call Tally.
 */
export class TallySyncRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
  findByInvoice(tenantId, invoiceId) { return this.findOne(tenantId, { invoiceId: String(invoiceId) }); }

  /**
   * Atomically creates (if absent) or claims an existing non-SYNCING/non-SYNCED record for retry, moving
   * it to SYNCING. Returns the claimed document, or null if another request already holds the claim
   * (status is SYNCING) or the invoice is already SYNCED (caller should treat that as already-done).
   */
  async conditionalUpdate(tenantId, invoiceId, matchExtra, patch) {
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), invoiceId: String(invoiceId), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }

  /** Creates the very first record for an invoice, already claimed as SYNCING. Relies on the unique index to reject a race. */
  async createClaim(tenantId, invoiceId, integrationId, actorId) {
    try {
      return await this.create(tenantId, {
        invoiceId: String(invoiceId), integrationId: integrationId ? String(integrationId) : undefined,
        status: 'SYNCING', attempt: 1, startedAt: new Date(),
      }, actorId);
    } catch (err) {
      if (err.code === 11000) return null; // lost the race to a concurrent request
      throw err;
    }
  }
}

/**
 * Phase 8 — GST filing workflow tracker. `conditionalUpdate` guards every state-machine transition with the
 * current status as part of the atomic filter (same pattern as InvoiceRepository/TallySyncRepository), so
 * two simultaneous "submit" calls cannot both win.
 */
export class GSTFilingRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  async conditionalUpdate(tenantId, id, matchExtra, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }
}

/** Phase 19 — GST Bill Builder. One bill per filing (unique (tenantId, filingId) index on the schema), so
 * `findByFiling` is the load path for "create if none exists, else edit the existing one" (no transaction
 * needed — the whole bill, including its line items, is a single embedded document). */
export class GSTBillRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
  findByFiling(tenantId, filingId) { return this.findOne(tenantId, { filingId: String(filingId) }); }
}

/** Phase 20 — GST Bill <-> Tally matching result. One row per filing (unique (tenantId, filingId) index on
 * the schema); `upsertByFiling` is the same create-or-replace-in-place upsert pattern TallyIntegrationRepository
 * uses for its one-per-tenant config row, so re-running matching never creates a second stale row. */
export class GSTBillMatchRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  findByFiling(tenantId, filingId) { return this.findOne(tenantId, { filingId: String(filingId) }); }

  async upsertByFiling(tenantId, filingId, patch, actorId) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !['_id', 'tenantId', 'filingId', 'createdAt'].includes(k)));
    if (actorId) clean.updatedBy = actorId;
    return this.model.findOneAndUpdate(
      this.scope(tenantId, { filingId: String(filingId) }),
      { $set: clean, $setOnInsert: { tenantId: String(tenantId), filingId: String(filingId), createdBy: actorId } },
      { upsert: true, returnDocument: 'after' },
    ).lean();
  }
}

export class GSTFilingIssueRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }
  listByFiling(tenantId, filingId) { return this.model.find(this.scope(tenantId, { filingId: String(filingId) })).sort({ createdAt: -1 }).lean(); }

  /** Cross-filing IDOR guard: an issue is only ever mutated through the filing it actually belongs to. */
  async findOneForFiling(tenantId, filingId, issueId) {
    if (!isObjectId(issueId)) return null;
    return this.model.findOne(this.scope(tenantId, { _id: String(issueId), filingId: String(filingId) })).lean();
  }
}

/**
 * Phase 15 — Bill Intake + Tally Queue. `conditionalUpdate` guards every status-machine transition with the
 * current status as part of the atomic filter (same pattern as InvoiceRepository/GSTFilingRepository), so
 * two simultaneous review/reject/approve/queue actions on the same bill cannot both win (spec Step 18).
 */
export class BillIntakeRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['billNumber', 'vendorName'], dateField: 'billDate' }); }

  async conditionalUpdate(tenantId, id, matchExtra, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }

  /** Tally-queue projection: every bill currently READY_FOR_TALLY or later in the Tally-facing lifecycle, across the given tenant filter. */
  async findQueue({ tenantIds, tallyStatus, page, limit, skip }) {
    const q = { status: { $in: ['READY_FOR_TALLY', 'ACCOUNTING_IN_PROGRESS', 'COMPLETED'] } };
    if (tenantIds) q.tenantId = { $in: tenantIds.map(String) };
    if (tallyStatus) q.tallyStatus = tallyStatus;
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ readyForTallyAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }
}

/**
 * Phase 16 — Tally connector credential storage (Side A). `findByHash` is intentionally NOT tenant-scoped
 * (same reasoning as TallyApiKeyRepository#findByHash above): tenant identity is resolved FROM the matched
 * record, not supplied by the caller, so authentication must be able to look a secret up before any tenant
 * is known.
 */
export class TallyConnectorRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  findByHash(secretHash) { return this.model.findOne({ secretHash }).lean(); }

  listByTenant(tenantId) { return this.model.find(this.scope(tenantId)).sort({ createdAt: -1 }).lean(); }

  /** Atomic conditional update — used for revoke/rotate so a concurrent revoke+rotate can't race silently. */
  async conditionalUpdate(tenantId, id, matchExtra, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id), ...matchExtra },
      { $set: patch },
      { returnDocument: 'after' },
    ).lean();
  }

  /** Heartbeat write — not conditional on status so a connector mid-revocation still records its last-seen state for diagnostics. */
  async recordHeartbeat(id, patch) {
    return this.model.findOneAndUpdate({ _id: String(id) }, { $set: patch }, { returnDocument: 'after' }).lean();
  }

  /**
   * Phase 16.1 offline monitor (spec Step 4): ACTIVE connectors whose heartbeat is older than the
   * cutoff, across ALL tenants (the scheduler is a single platform-wide sweep, never scoped to one
   * tenant request) — but each match still carries its own tenantId so the caller can audit/notify
   * per-tenant without ever merging tenants together.
   */
  findStaleActive(cutoffDate) {
    return this.model.find({
      status: TALLY_CONNECTOR_STATUS.ACTIVE,
      $or: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { $lt: cutoffDate } }],
    }).lean();
  }

  /** Idempotent: only flips a row that is still ACTIVE, so a concurrent heartbeat wins the race cleanly. */
  async markOfflineIfActive(id) {
    return this.model.findOneAndUpdate(
      { _id: String(id), status: TALLY_CONNECTOR_STATUS.ACTIVE },
      { $set: { status: TALLY_CONNECTOR_STATUS.INACTIVE, offlineSince: new Date() } },
      { returnDocument: 'after' },
    ).lean();
  }

  /** Idempotent: only flips a row that is still INACTIVE-via-offline-monitor, so a manual INACTIVE isn't touched by a stray heartbeat. */
  async markOnlineIfOfflineMonitored(id) {
    return this.model.findOneAndUpdate(
      { _id: String(id), status: TALLY_CONNECTOR_STATUS.INACTIVE, offlineSince: { $ne: null } },
      { $set: { status: TALLY_CONNECTOR_STATUS.ACTIVE, offlineSince: null } },
      { returnDocument: 'after' },
    ).lean();
  }
}

/**
 * Phase 16 — Tally job queue (Side A). `claimNext` is the ONE atomic operation the whole connector-claiming
 * guarantee rests on (spec Step 11): findOneAndUpdate's status-in-filter + status-in-$set is a single
 * atomic Mongo operation, so of two connectors racing for the same job, exactly one gets a non-null result.
 */
export class TallyJobRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  /** Idempotent creation: relies on the (tenantId, billIntakeId, type) unique index — a duplicate insert
   * throws a Mongo E11000 which the service layer catches and treats as "job already exists". */
  async createIdempotent(tenantId, data, actorId) {
    return this.create(tenantId, data, actorId);
  }

  findActiveForBill(tenantId, billIntakeId, type) {
    return this.findOne(tenantId, { billIntakeId: String(billIntakeId), type });
  }

  /** Jobs visible to a given connector's tenant: QUEUED and due (availableAt <= now). Unclaimed/retry-eligible only. */
  listClaimable(tenantId, { limit = 20 } = {}) {
    return this.model.find(this.scope(tenantId, { status: 'QUEUED', availableAt: { $lte: new Date() } }))
      .sort({ availableAt: 1 }).limit(limit).lean();
  }

  /** The one atomic claim operation (spec Step 11): QUEUED -> CLAIMED, only if still QUEUED and due, and
   * (once claimed) bound to the claiming connector so a second connector can never also "win" the same row. */
  async claim(tenantId, jobId, connectorId) {
    if (!isObjectId(jobId)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(jobId), status: 'QUEUED', availableAt: { $lte: new Date() } },
      { $set: { status: 'CLAIMED', connectorId: String(connectorId), claimedAt: new Date() }, $inc: { attempts: 1 } },
      { returnDocument: 'after' },
    ).lean();
  }

  /** CLAIMED -> PROCESSING, only by the connector that holds the claim. */
  async startProcessing(tenantId, jobId, connectorId) {
    if (!isObjectId(jobId)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(jobId), status: 'CLAIMED', connectorId: String(connectorId) },
      { $set: { status: 'PROCESSING', startedAt: new Date() } },
      { returnDocument: 'after' },
    ).lean();
  }

  /** PROCESSING -> SUCCEEDED. Only the connector holding the job may report a result (spec Step 16/22 — IDOR guard). */
  async succeed(tenantId, jobId, connectorId, { tallyReference, requestId } = {}) {
    if (!isObjectId(jobId)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(jobId), status: 'PROCESSING', connectorId: String(connectorId) },
      { $set: { status: 'SUCCEEDED', completedAt: new Date(), tallyReference, requestId } },
      { returnDocument: 'after' },
    ).lean();
  }

  /** PROCESSING -> FAILED (terminal for this attempt; retry() below is the only path back to QUEUED).
   * Also accepts CLAIMED (Phase 17 fix): the company-binding safety check in tallyJob.service.js#claim()
   * fails a job BEFORE startProcessing() is called, so at that point the job is still CLAIMED, not
   * PROCESSING yet — the original PROCESSING-only guard silently no-op'd in that case, leaving the job
   * stuck CLAIMED forever (never re-claimable, since listClaimable only looks at QUEUED). Found via the
   * Phase 17 "company mismatch fails safely" regression test. */
  async fail(tenantId, jobId, connectorId, { errorCode, errorMessage, requestId } = {}) {
    if (!isObjectId(jobId)) return null;
    return this.model.findOneAndUpdate(
      {
        ...this.scope(tenantId), _id: String(jobId), status: { $in: ['PROCESSING', 'CLAIMED'] }, connectorId: String(connectorId),
      },
      { $set: { status: 'FAILED', failedAt: new Date(), lastErrorCode: errorCode, lastErrorMessage: errorMessage, requestId } },
      { returnDocument: 'after' },
    ).lean();
  }

  /** FAILED -> QUEUED with backoff (spec Step 18). Never applied to SUCCEEDED (spec Step 17: no reversal). */
  async retry(tenantId, jobId, availableAt) {
    if (!isObjectId(jobId)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(jobId), status: 'FAILED' },
      { $set: { status: 'QUEUED', availableAt, connectorId: null, claimedAt: null, startedAt: null } },
      { returnDocument: 'after' },
    ).lean();
  }

  listForQueue(tenantIds, { status, page = 1, limit = 20, skip = 0 } = {}) {
    const q = {};
    if (tenantIds) q.tenantId = { $in: tenantIds.map(String) };
    if (status) q.status = status;
    return Promise.all([
      this.model.find(q).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]).then(([items, total]) => ({ items, total, page, limit }));
  }
}
