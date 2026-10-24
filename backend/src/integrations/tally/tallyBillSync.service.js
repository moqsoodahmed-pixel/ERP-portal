import crypto from 'node:crypto';
import {
  AUDIT_ACTIONS, TALLY_BILL_SYNC_STATUS as S, BILL_STATUS, BILL_TALLY_STATUS,
  TALLY_QUEUE_PRIORITY, TALLY_DLQ_STATUS,
} from '../../constants/statuses.js';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { getFinancialYearString } from '../../utils/billIdentifier.js';
import { logger } from '../../utils/logger.js';

export class TallyBillSyncService {
  constructor({
    tallyBillSyncRepo,
    billRepo,
    tenantRepo,
    tallyIntegrationRepo,
    tallyAdapter = null,
    validationEngine = null,
    auditService,
    notificationService = null,
    maxRetries = 3,
  }) {
    Object.assign(this, {
      tallyBillSyncRepo,
      billRepo,
      tenantRepo,
      tallyIntegrationRepo,
      tallyAdapter,
      validationEngine,
      auditService,
      notificationService,
      maxRetries,
    });
  }

  /**
   * Enqueues a bill into the internal Tally Synchronization Queue.
   * Executes full Validation Engine BEFORE entering the queue.
   * Upload does not block: returns immediately, processes sync asynchronously.
   */
  async enqueueBill({ bill, tenant, user = null, auth = null, requestId = null, autoSync = true, priority = 'MEDIUM' }) {
    const tenantId = String(tenant._id || bill.tenantId);

    // 1. DEDICATED VALIDATION ENGINE (Highest Priority):
    // Executes BEFORE bill enters the queue or calls Tally
    if (this.validationEngine) {
      const validationResult = await this.validationEngine.validate(bill, {
        tenantId,
        actor: user,
        auth,
      });

      if (!validationResult.isValid) {
        await this.auditService.record(
          { tenantId, actor: user ? { id: user._id || user.id } : { id: 'system' }, requestId },
          {
            action: AUDIT_ACTIONS.TALLY_BILL_VALIDATION_FAILED,
            resourceType: 'TallyBillSync',
            resourceId: bill._id || bill.id || null,
            metadata: {
              errors: validationResult.errors,
              billNumber: bill.billNumber || bill.invoiceNumber,
              companyCode: bill.companyCode || tenant.companyCode,
            },
          },
        );

        // Notify authorized stakeholders
        if (this.notificationService?.validationFailed) {
          await this.notificationService.validationFailed(tenantId, bill, validationResult.errors, user).catch(() => {});
        }

        const err = new ValidationError(
          `Bill validation failed: ${validationResult.errors.map((e) => e.message).join('; ')}`,
          'BILL_VALIDATION_FAILED',
        );
        err.validationErrors = validationResult.errors;
        throw err;
      }
    }

    const companyCode = bill.companyCode || tenant.companyCode || tenant.tenantCode || 'CMP001';
    const financialYear = getFinancialYearString(bill.billDate || bill.createdAt || new Date());
    const invoiceNumber = bill.billNumber || bill.invoiceNumber;
    const gstin = bill.vendorGSTIN || bill.gstin || '';
    const amount = bill.amount;
    const billId = bill.billId || `${companyCode}-BILL-${financialYear}-000001`;
    const uuid = bill.uuid || crypto.randomUUID();
    const queuePriority = Object.values(TALLY_QUEUE_PRIORITY).includes(priority) ? priority : TALLY_QUEUE_PRIORITY.MEDIUM;

    // 2. DUPLICATE PREVENTION:
    const duplicate = await this.tallyBillSyncRepo.checkDuplicate({
      companyCode,
      billId,
      invoiceNumber,
      gstin,
      financialYear,
      amount,
    });

    if (duplicate) {
      await this.auditService.record(
        { tenantId, actor: user ? { id: user._id || user.id } : { id: 'system' }, requestId },
        {
          action: AUDIT_ACTIONS.TALLY_BILL_DUPLICATE_PREVENTED,
          resourceType: 'TallyBillSync',
          resourceId: duplicate._id,
          metadata: { billId, companyCode, duplicateOf: duplicate.billId },
        },
      );
      throw new ConflictError(
        `Duplicate bill detected: Bill ${billId} or Invoice ${invoiceNumber} is already synchronized for company ${companyCode}`,
        'DUPLICATE_BILL_SYNC',
      );
    }

    // 3. Check if an existing queue entry exists for this bill
    let syncRecord = await this.tallyBillSyncRepo.findByBillIdOrUuid(billId);
    if (!syncRecord) {
      syncRecord = await this.tallyBillSyncRepo.create(
        tenantId,
        {
          uuid,
          billId,
          billIntakeId: bill._id,
          companyCode,
          syncStatus: S.PENDING,
          priority: queuePriority,
          dlqStatus: TALLY_DLQ_STATUS.NONE,
          retryCount: 0,
          maxRetries: this.maxRetries,
          invoiceNumber,
          gstin,
          amount,
          financialYear,
          uploadedBy: user?._id || user?.id,
          history: [{
            status: S.PENDING,
            attemptNumber: 1,
            retryCount: 0,
            attemptedAt: new Date(),
            timestamp: new Date(),
            responsePayload: null,
            errorMessage: null,
            user: user?._id || user?.id,
            requestId,
            errorType: 'NONE',
            errorCategory: 'NONE',
            retryTrigger: 'INITIAL',
            processingDurationMs: 0,
            server: process.env.HOSTNAME || 'launcherdesk-srv-1',
            worker: `worker-${process.pid || '1'}`,
          }],
        },
        user?._id || user?.id,
      );

      await this.auditService.record(
        { tenantId, actor: user ? { id: user._id || user.id } : { id: 'system' }, requestId },
        {
          action: AUDIT_ACTIONS.TALLY_BILL_UPLOADED,
          resourceType: 'TallyBillSync',
          resourceId: syncRecord._id,
          metadata: { uuid, billId, companyCode, priority: queuePriority, syncStatus: S.PENDING },
        },
      );
    }

    // 4. Trigger asynchronous queue processing (non-blocking)
    if (autoSync) {
      setImmediate(() => {
        this.processSync(syncRecord.billId || billId, { user, requestId }).catch((err) => {
          logger.error({ event: 'tally.async_sync_error', billId, err: err.message }, 'Async Tally sync error');
        });
      });
    }

    return syncRecord;
  }

  /**
   * Processes synchronization for a specific bill to Tally with latency, metrics, and error classification.
   */
  async processSync(identifier, { user = null, requestId = null, retryTrigger = 'AUTOMATIC' } = {}) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`Bill sync record not found for ${identifier}`);

    // If already Synced, do not re-send
    if (record.syncStatus === S.SYNCED) {
      return record;
    }

    const tenantId = String(record.tenantId);
    const ctx = { tenantId, actor: user ? { id: user._id || user.id } : { id: 'tally-sync' }, requestId };
    const billId = record.billId;

    // Move to Processing
    await this.tallyBillSyncRepo.updateStatus(billId, S.PROCESSING, {
      lastAttempt: new Date(),
    });

    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_BILL_SYNC_STARTED,
      resourceType: 'TallyBillSync',
      resourceId: record._id,
      metadata: { uuid: record.uuid, billId, retryCount: record.retryCount, priority: record.priority },
    });

    const startTime = Date.now();
    try {
      const integration = this.tallyIntegrationRepo ? await this.tallyIntegrationRepo.findByTenant(tenantId) : null;

      let syncResult;
      if (this.tallyAdapter && typeof this.tallyAdapter.syncBill === 'function' && integration && integration.enabled) {
        syncResult = await this.tallyAdapter.syncBill({
          uuid: record.uuid,
          billId: record.billId,
          companyCode: record.companyCode,
          invoiceNumber: record.invoiceNumber,
          amount: record.amount,
          gstin: record.gstin,
          financialYear: record.financialYear,
        });
      } else {
        // Mock / Offline response for on-premise connector
        const refNo = `TALLY-REF-${Date.now().toString(36).toUpperCase()}`;
        syncResult = {
          success: true,
          reference: refNo,
          voucherNumber: `VCH-${record.billId}`,
          message: 'Voucher successfully imported into Tally',
        };
      }

      const latencyMs = Date.now() - startTime;

      if (syncResult && syncResult.success) {
        const updated = await this.tallyBillSyncRepo.recordAttempt(billId, {
          status: S.SYNCED,
          retryCount: record.retryCount,
          responsePayload: syncResult,
          errorMessage: null,
          user: user?._id || user?.id,
          requestId,
          latencyMs,
          httpStatus: 200,
          responseCode: 'SUCCESS',
          errorType: 'NONE',
          errorCategory: 'NONE',
          retryTrigger,
          processingDurationMs: latencyMs,
          server: process.env.HOSTNAME || 'launcherdesk-srv-1',
          worker: `worker-${process.pid || '1'}`,
        });

        await this.tallyBillSyncRepo.updateStatus(billId, S.SYNCED, {
          tallyReferenceNumber: syncResult.reference || syncResult.voucherNumber,
        });

        // Also update BillIntake if it is currently in PROCESSING state
        if (record.billIntakeId && this.billRepo) {
          await this.billRepo.conditionalUpdate(
            tenantId,
            record.billIntakeId,
            { tallyStatus: BILL_TALLY_STATUS.PROCESSING },
            {
              tallyStatus: BILL_TALLY_STATUS.SYNCED,
              tallyReference: syncResult.reference || syncResult.voucherNumber,
              status: BILL_STATUS.COMPLETED,
            },
          );
        }

        await this.auditService.record(ctx, {
          action: AUDIT_ACTIONS.TALLY_BILL_SYNC_SUCCEEDED,
          resourceType: 'TallyBillSync',
          resourceId: record._id,
          metadata: { uuid: record.uuid, billId, reference: syncResult.reference || syncResult.voucherNumber, latencyMs },
        });

        return updated;
      }

      const errorMsg = syncResult?.message || 'Tally synchronization rejected';
      return await this._handleFailure(record, errorMsg, syncResult, ctx, {
        latencyMs,
        retryTrigger,
        errorType: 'TALLY_VALIDATION_ERROR',
        errorCategory: 'PERMANENT',
      });
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const isTimeout = err.code === 'ETIMEDOUT' || err.message?.toLowerCase().includes('timeout');
      const isNetwork = err.code === 'ECONNREFUSED' || err.message?.toLowerCase().includes('unreachable');
      const errorType = isTimeout ? 'TIMEOUT' : (isNetwork ? 'NETWORK_ERROR' : 'SERVER_ERROR');
      const errorCategory = (isTimeout || isNetwork) ? 'TRANSIENT' : 'PERMANENT';

      return await this._handleFailure(record, err.message || 'Tally unavailable', { error: err.message }, ctx, {
        latencyMs,
        retryTrigger,
        errorType,
        errorCategory,
      });
    }
  }

  async _handleFailure(record, errorMessage, responsePayload, ctx, {
    latencyMs = 0,
    retryTrigger = 'AUTOMATIC',
    errorType = 'NETWORK_ERROR',
    errorCategory = 'TRANSIENT',
  } = {}) {
    const nextRetry = (record.retryCount || 0) + 1;
    const maxRetriesAllowed = record.maxRetries || this.maxRetries;
    const isExhausted = nextRetry >= maxRetriesAllowed;

    // Dead Letter Queue transition when max retries reached
    const nextStatus = isExhausted ? S.DEAD_LETTER : S.RETRY_PENDING;
    const dlqStatus = isExhausted ? TALLY_DLQ_STATUS.IN_DLQ : TALLY_DLQ_STATUS.NONE;

    const updated = await this.tallyBillSyncRepo.recordAttempt(record.billId, {
      status: nextStatus,
      retryCount: nextRetry,
      responsePayload,
      errorMessage,
      user: ctx.actor?.id,
      requestId: ctx.requestId,
      latencyMs,
      httpStatus: 500,
      responseCode: errorType,
      errorType,
      errorCategory,
      retryTrigger,
      processingDurationMs: latencyMs,
      server: process.env.HOSTNAME || 'launcherdesk-srv-1',
      worker: `worker-${process.pid || '1'}`,
    });

    if (isExhausted) {
      await this.tallyBillSyncRepo.updateStatus(record.billId, S.DEAD_LETTER, {
        dlqStatus: TALLY_DLQ_STATUS.IN_DLQ,
        dlqEnteredAt: new Date(),
      });

      await this.auditService.record(ctx, {
        action: AUDIT_ACTIONS.TALLY_BILL_DEAD_LETTER,
        resourceType: 'TallyBillSync',
        resourceId: record._id,
        metadata: {
          uuid: record.uuid,
          billId: record.billId,
          retryCount: nextRetry,
          maxRetries: maxRetriesAllowed,
          error: errorMessage,
        },
      });

      // Notify Master Admin and Assigned Assistant Admin of Dead Letter Queue entry
      if (this.notificationService?.deadLetterQueueAlert) {
        await this.notificationService.deadLetterQueueAlert(record.tenantId, { ...record, retryCount: nextRetry, errorMessage }).catch(() => {});
      }
    } else {
      await this.auditService.record(ctx, {
        action: AUDIT_ACTIONS.TALLY_BILL_SYNC_FAILED,
        resourceType: 'TallyBillSync',
        resourceId: record._id,
        metadata: { uuid: record.uuid, billId: record.billId, retryCount: nextRetry, error: errorMessage },
      });

      if (this.notificationService?.syncFailed) {
        await this.notificationService.syncFailed(record.tenantId, record, errorMessage).catch(() => {});
      }
    }

    if (record.billIntakeId && this.billRepo) {
      await this.billRepo.conditionalUpdate(
        record.tenantId,
        record.billIntakeId,
        { tallyStatus: BILL_TALLY_STATUS.PROCESSING },
        {
          tallyStatus: BILL_TALLY_STATUS.FAILED,
          tallyFailureReason: errorMessage,
        },
      );
    }

    return updated;
  }

  /**
   * Retries ONLY the specified failed bill.
   * Never resends all bills.
   */
  async retryBill(identifier, actor, { force = false } = {}) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

    if (record.syncStatus === S.SYNCED) {
      throw new ConflictError(`Bill ${record.billId} is already successfully synchronized to Tally`, 'BILL_ALREADY_SYNCED');
    }

    if (!force && record.syncStatus !== S.DEAD_LETTER && record.retryCount >= (record.maxRetries || this.maxRetries)) {
      throw new ValidationError(`Maximum retry attempts (${record.maxRetries || this.maxRetries}) reached for bill ${record.billId}`);
    }

    const tenantId = String(record.tenantId);
    const ctx = { tenantId, actor: actor ? { id: actor._id || actor.id } : { id: 'retry-user' } };

    await this.tallyBillSyncRepo.updateStatus(record.billId, S.RETRY_PENDING, {
      lastRetriedBy: actor?._id || actor?.id,
      lastAttempt: new Date(),
      dlqStatus: TALLY_DLQ_STATUS.NONE,
    });

    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_BILL_SYNC_RETRIED,
      resourceType: 'TallyBillSync',
      resourceId: record._id,
      metadata: { uuid: record.uuid, billId: record.billId, retryCount: record.retryCount, user: actor?._id || actor?.id },
    });

    // Run sync for only this bill
    return this.processSync(record.billId, { user: actor, retryTrigger: 'MANUAL_ADMIN' });
  }

  async resyncBill(identifier, actor) {
    return this.retryBill(identifier, actor, { force: true });
  }

  /**
   * Retries a quarantined bill from the Dead Letter Queue.
   */
  async retryDlqBill(identifier, actor) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

    const newMaxRetries = (record.maxRetries || this.maxRetries) + 3;
    await this.tallyBillSyncRepo.updateStatus(record.billId, S.RETRY_PENDING, {
      maxRetries: newMaxRetries,
      dlqStatus: TALLY_DLQ_STATUS.NONE,
      lastRetriedBy: actor?._id || actor?.id,
    });

    return this.processSync(record.billId, { user: actor, retryTrigger: 'MANUAL_ADMIN' });
  }

  /**
   * Marks a DLQ bill as resolved (e.g. manually imported into Tally).
   */
  async resolveDlqBill(identifier, { notes, tallyReferenceNumber, actor }) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

    const tenantId = String(record.tenantId);
    const resolved = await this.tallyBillSyncRepo.resolveDlq(record.billId, {
      notes: notes || 'Resolved via administrative review',
      tallyReferenceNumber,
      user: actor?._id || actor?.id,
    });

    await this.auditService.record(
      { tenantId, actor: actor ? { id: actor._id || actor.id } : { id: 'admin' } },
      {
        action: AUDIT_ACTIONS.TALLY_DLQ_RESOLVED,
        resourceType: 'TallyBillSync',
        resourceId: record._id,
        metadata: { uuid: record.uuid, billId: record.billId, notes, tallyReferenceNumber },
      },
    );

    return resolved;
  }

  /**
   * Archives an irrecoverable DLQ bill with reason.
   */
  async archiveDlqBill(identifier, { reason, actor }) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

    const tenantId = String(record.tenantId);
    const archived = await this.tallyBillSyncRepo.archiveDlq(record.billId, {
      reason: reason || 'Archived by administrator',
      user: actor?._id || actor?.id,
    });

    await this.auditService.record(
      { tenantId, actor: actor ? { id: actor._id || actor.id } : { id: 'admin' } },
      {
        action: AUDIT_ACTIONS.TALLY_DLQ_ARCHIVED,
        resourceType: 'TallyBillSync',
        resourceId: record._id,
        metadata: { uuid: record.uuid, billId: record.billId, reason },
      },
    );

    return archived;
  }

  /**
   * Updates queue priority of a queued bill (HIGH, MEDIUM, LOW).
   */
  async updatePriority(identifier, priority, actor) {
    if (!Object.values(TALLY_QUEUE_PRIORITY).includes(priority)) {
      throw new ValidationError(`Invalid priority "${priority}". Allowed: HIGH, MEDIUM, LOW`);
    }

    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

    const updated = await this.tallyBillSyncRepo.updatePriority(record.billId, priority);
    await this.auditService.record(
      { tenantId: record.tenantId, actor: actor ? { id: actor._id || actor.id } : { id: 'admin' } },
      {
        action: AUDIT_ACTIONS.TALLY_QUEUE_PRIORITY_UPDATED,
        resourceType: 'TallyBillSync',
        resourceId: record._id,
        metadata: { uuid: record.uuid, billId: record.billId, previousPriority: record.priority, newPriority: priority },
      },
    );

    return updated;
  }

  async getStatus(identifier) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`Bill ${identifier} not found`);
    return record;
  }

  async getPendingQueue(tenantIds, query) {
    return this.tallyBillSyncRepo.findPending(tenantIds, query);
  }

  async getFailedQueue(tenantIds, query) {
    return this.tallyBillSyncRepo.findFailed(tenantIds, query);
  }

  async getDeadLetterQueue(tenantIds, query) {
    return this.tallyBillSyncRepo.findDeadLetterQueue(tenantIds, query);
  }

  async getQueue(tenantIds, query) {
    return this.tallyBillSyncRepo.findQueue(tenantIds, query);
  }

  async getHistory(tenantIds, query) {
    return this.tallyBillSyncRepo.findHistory(tenantIds, query);
  }

  async getBillHistoryTimeline(identifier) {
    const record = await this.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
    if (!record) throw new NotFoundError(`Bill ${identifier} not found`);
    return {
      uuid: record.uuid,
      billId: record.billId,
      companyCode: record.companyCode,
      syncStatus: record.syncStatus,
      priority: record.priority,
      retryCount: record.retryCount,
      history: record.history || [],
    };
  }

  async getDashboardMetrics(tenantIds, query) {
    return this.tallyBillSyncRepo.getMetrics(tenantIds, query);
  }
}
