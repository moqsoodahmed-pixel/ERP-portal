import {
  AUDIT_ACTIONS, TALLY_JOB_STATUS as JS, BILL_TALLY_STATUS,
} from '../../constants/statuses.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { TALLY_JOB_TYPES, TALLY_JOB_RETRY_POLICY, TALLY_ERROR_CODES } from './tally.constants.js';
import { buildBillJobPayload } from './tally.payloadBuilder.js';

const SYNC_BILL_TO_TALLY = 'SYNC_BILL_TO_TALLY';

const toView = (job) => ({
  id: job._id,
  tenantId: job.tenantId,
  billIntakeId: job.billIntakeId,
  connectorId: job.connectorId,
  type: job.type,
  status: job.status,
  attempts: job.attempts,
  availableAt: job.availableAt,
  claimedAt: job.claimedAt ?? null,
  completedAt: job.completedAt ?? null,
  failedAt: job.failedAt ?? null,
  lastErrorCode: job.lastErrorCode ?? null,
  lastErrorMessage: job.lastErrorMessage ?? null,
  tallyReference: job.tallyReference ?? null,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

/**
 * Phase 16 — Tally Job lifecycle (Side A). Owns job creation (from a READY_FOR_TALLY BillIntake),
 * connector-visible claimable listing, atomic claiming, and result reporting. Deliberately does NOT
 * duplicate BillIntakeService's status machine — every job-driven bill transition goes back through the
 * EXISTING BillIntakeService methods (tallyProcessingStarted/tallySynced/tallyFailed/tallyRetry), so there
 * is exactly one place bill.tallyStatus transitions happen, Phase 15 or Phase 16 alike.
 */
export class TallyJobService {
  constructor({
    tallyJobRepo, billRepo, tallyIntegrationRepo, tallyConnectorRepo, billIntakeService, auditService, notificationService = null,
  }) {
    Object.assign(this, {
      tallyJobRepo, billRepo, tallyIntegrationRepo, tallyConnectorRepo, billIntakeService, auditService, notificationService,
    });
  }

  /**
   * Idempotent job creation (spec Step 10/19). Called once a BillIntake reaches READY_FOR_TALLY /
   * tallyStatus QUEUED. The (tenantId, billIntakeId, type) unique index is the actual idempotency
   * guarantee — a duplicate call (double review, retried request, concurrent approvals) hits a Mongo
   * E11000 duplicate-key error, which is caught here and treated as "already exists", never as a failure.
   */
  async createForBill(ctx, bill, type = SYNC_BILL_TO_TALLY) {
    if (!TALLY_JOB_TYPES.includes(type)) throw new ValidationError('Unknown Tally job type');
    const existing = await this.tallyJobRepo.findActiveForBill(ctx.tenantId, bill._id, type);
    if (existing) return toView(existing);
    const idempotencyKey = `${ctx.tenantId}:${bill._id}:${type}`;
    try {
      const job = await this.tallyJobRepo.createIdempotent(ctx.tenantId, {
        billIntakeId: String(bill._id), type, status: JS.QUEUED, attempts: 0, availableAt: new Date(), idempotencyKey,
      }, ctx.actor?.id);
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_JOB_CREATED, resourceType: 'TallyJob', resourceId: job._id, metadata: { billIntakeId: String(bill._id), type } });
      return toView(job);
    } catch (err) {
      if (err?.code === 11000) {
        const raced = await this.tallyJobRepo.findActiveForBill(ctx.tenantId, bill._id, type);
        if (raced) return toView(raced);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- connector-facing (spec Step 7/11/12)
  /** GET /tally/connector/jobs — only this connector's tenant, only claimable (QUEUED and due) jobs. */
  async listClaimable(connectorAuth) {
    const jobs = await this.tallyJobRepo.listClaimable(connectorAuth.tenantId, { limit: 20 });
    return jobs.map((j) => ({ id: j._id, type: j.type, billIntakeId: j.billIntakeId, attempts: j.attempts, availableAt: j.availableAt }));
  }

  /** POST /tally/connector/jobs/:jobId/claim — atomic; the loser of a race gets a safe conflict, never a corrupted job (spec Step 11). */
  async claim(connectorAuth, jobId) {
    const claimed = await this.tallyJobRepo.claim(connectorAuth.tenantId, jobId, connectorAuth.connectorId);
    if (!claimed) {
      await this.auditService.record({ tenantId: connectorAuth.tenantId, actor: { id: connectorAuth.connectorId } }, {
        action: AUDIT_ACTIONS.TALLY_JOB_CLAIM_CONFLICT, resourceType: 'TallyJob', resourceId: jobId, metadata: {},
      });
      throw new ConflictError('Job is no longer available to claim', 'TALLY_JOB_NOT_CLAIMABLE');
    }
    const ctx = { tenantId: connectorAuth.tenantId, actor: { id: connectorAuth.connectorId } };
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_JOB_CLAIMED, resourceType: 'TallyJob', resourceId: jobId, metadata: { connectorId: connectorAuth.connectorId } });

    const bill = await this.billRepo.findOneById(connectorAuth.tenantId, claimed.billIntakeId);
    if (!bill) throw new NotFoundError('Bill for this job no longer exists');
    // Tenant-triple verification (spec Step 8/15): connector tenant == job tenant == bill tenant. The
    // repository scope calls above already enforce this structurally (every query is tenant-scoped off the
    // AUTHENTICATED connector's tenant), but it is asserted again explicitly as defence in depth.
    if (String(bill.tenantId) !== String(connectorAuth.tenantId) || String(claimed.tenantId) !== String(connectorAuth.tenantId)) {
      throw new ConflictError('Tenant mismatch between connector, job and bill', 'TALLY_TENANT_MISMATCH');
    }
    const integration = await this.tallyIntegrationRepo.findByTenant(connectorAuth.tenantId);
    const connector = await this.tallyConnectorRepo.findOneById(connectorAuth.tenantId, connectorAuth.connectorId);
    // Company-binding fail-safe (spec Step 15): if the connector's registered company identity doesn't
    // match the tenant's current TallyIntegration configuration, refuse to hand out a payload at all rather
    // than risk sending data to an unverified/unknown Tally company.
    if (!integration?.companyName || !connector?.tallyCompanyName || integration.companyName !== connector.tallyCompanyName) {
      await this.tallyJobRepo.fail(connectorAuth.tenantId, jobId, connectorAuth.connectorId, {
        errorCode: TALLY_ERROR_CODES.MAPPING_MISSING, errorMessage: 'Connector Tally company identity could not be verified against this tenant\'s configured TallyIntegration',
      });
      throw new ConflictError('Connector company binding could not be verified', 'TALLY_COMPANY_BINDING_UNVERIFIED');
    }
    await this.billIntakeService.tallyProcessingStarted(ctx, bill).catch(() => {}); // best-effort status surfacing; job state is authoritative
    await this.tallyJobRepo.startProcessing(connectorAuth.tenantId, jobId, connectorAuth.connectorId);
    return {
      id: claimed._id,
      type: claimed.type,
      payload: buildBillJobPayload(bill, integration),
    };
  }

  /**
   * POST /tally/connector/jobs/:jobId/result (spec Step 16/17). Only a job this connector currently holds
   * in PROCESSING can be resolved — the repository's conditional update IS the state-machine guard, so an
   * arbitrary/replayed/forged status transition is simply a no-op 409, never accepted.
   */
  async reportResult(connectorAuth, jobId, result) {
    const ctx = { tenantId: connectorAuth.tenantId, actor: { id: connectorAuth.connectorId } };
    const job = await this.tallyJobRepo.findOneById(connectorAuth.tenantId, jobId);
    if (!job) throw new NotFoundError('Job not found');
    const bill = job.billIntakeId ? await this.billRepo.findOneById(connectorAuth.tenantId, job.billIntakeId) : null;

    if (result.status === 'SUCCEEDED') {
      const updated = await this.tallyJobRepo.succeed(connectorAuth.tenantId, jobId, connectorAuth.connectorId, {
        tallyReference: result.tallyReference, requestId: result.requestId,
      });
      if (!updated) throw new ConflictError('Job is not in a state that can be marked succeeded (already resolved, or claimed by another connector)', 'TALLY_JOB_INVALID_TRANSITION');
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_JOB_SUCCEEDED, resourceType: 'TallyJob', resourceId: jobId, metadata: { tallyReference: result.tallyReference } });
      await this.tallyConnectorRepo.recordHeartbeat(connectorAuth.connectorId, { lastSuccessfulSyncAt: new Date() });
      if (bill) await this.billIntakeService.tallySynced(ctx, bill, result.tallyReference);
      return toView(updated);
    }

    if (result.status === 'FAILED') {
      const updated = await this.tallyJobRepo.fail(connectorAuth.tenantId, jobId, connectorAuth.connectorId, {
        errorCode: result.errorCode, errorMessage: result.message, requestId: result.requestId,
      });
      if (!updated) throw new ConflictError('Job is not in a state that can be marked failed (already resolved, or claimed by another connector)', 'TALLY_JOB_INVALID_TRANSITION');
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_JOB_FAILED, resourceType: 'TallyJob', resourceId: jobId, metadata: { errorCode: result.errorCode } });
      if (bill) await this.billIntakeService.tallyFailed(ctx, bill, result.message ?? result.errorCode).catch(() => {});

      // Bounded retry (spec Step 18): only for transient/classified-retryable errors, and only up to maxAttempts.
      // TALLY_BUSY (Phase 17) is transient by nature (Tally is mid-import/report) so it's treated as
      // retryable like UNREACHABLE/TIMEOUT/SYNC_IN_PROGRESS; INVALID_LEDGER/INVALID_VOUCHER_TYPE/
      // COMPANY_NOT_FOUND/DUPLICATE_VOUCHER are configuration/data problems a blind retry can't fix.
      const retryableCodes = [TALLY_ERROR_CODES.UNREACHABLE, TALLY_ERROR_CODES.TIMEOUT, TALLY_ERROR_CODES.SYNC_IN_PROGRESS, TALLY_ERROR_CODES.BUSY];
      if (retryableCodes.includes(result.errorCode) && updated.attempts < TALLY_JOB_RETRY_POLICY.maxAttempts) {
        const backoffSeconds = TALLY_JOB_RETRY_POLICY.backoffSeconds[Math.min(updated.attempts - 1, TALLY_JOB_RETRY_POLICY.backoffSeconds.length - 1)];
        const availableAt = new Date(Date.now() + backoffSeconds * 1000);
        const retried = await this.tallyJobRepo.retry(connectorAuth.tenantId, jobId, availableAt);
        if (retried) {
          await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_JOB_RETRIED, resourceType: 'TallyJob', resourceId: jobId, metadata: { attempts: retried.attempts, availableAt } });
          if (bill) await this.billIntakeService.tallyRetry(ctx, bill).catch(() => {});
          return toView(retried);
        }
      }
      return toView(updated);
    }
    throw new ValidationError('result.status must be SUCCEEDED or FAILED');
  }

  async queueForUi(authCtx, tenantIds, query) {
    const r = await this.tallyJobRepo.listForQueue(tenantIds, { status: query.status, page: query.page, limit: query.limit, skip: query.skip });
    return { items: r.items.map(toView), total: r.total };
  }
}

export { BILL_TALLY_STATUS };
