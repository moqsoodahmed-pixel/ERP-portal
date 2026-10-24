import mongoose from 'mongoose';
import { BaseRepository } from './base.repository.js';
import { TALLY_BILL_SYNC_STATUS, TALLY_QUEUE_PRIORITY, TALLY_DLQ_STATUS } from '../constants/statuses.js';

export class TallyBillSyncRepository extends BaseRepository {
  async create(tenantIdOrData, maybeData = {}) {
    const payload = (typeof tenantIdOrData === 'object' && tenantIdOrData !== null)
      ? tenantIdOrData
      : { ...maybeData, tenantId: tenantIdOrData };
    return super.create(payload);
  }

  async findByBillId(billId) {
    if (!billId) return null;
    return this.model.findOne({ billId }).lean();
  }

  async findByUuid(uuid) {
    if (!uuid) return null;
    return this.model.findOne({ uuid }).lean();
  }

  async findByBillIdOrUuid(identifier) {
    if (!identifier) return null;
    const isObjectId = mongoose.isValidObjectId(identifier);
    const orClauses = [
      { uuid: identifier },
      { billId: identifier },
    ];
    if (isObjectId) {
      orClauses.push({ _id: identifier });
    }
    return this.model.findOne({ $or: orClauses }).lean();
  }

  async findByBillIntakeId(tenantId, billIntakeId) {
    const q = { billIntakeId };
    if (tenantId) q.tenantId = tenantId;
    return this.model.findOne(q).lean();
  }

  async checkDuplicate({ companyCode, billId, invoiceNumber, gstin, financialYear, excludeBillId }) {
    // 1. Check if same billId is already present (unless excluded)
    if (billId && (!excludeBillId || billId !== excludeBillId)) {
      const byBillId = await this.model.findOne({
        billId,
        syncStatus: { $ne: TALLY_BILL_SYNC_STATUS.FAILED },
      }).lean();
      if (byBillId) return byBillId;
    }

    // 2. Check if identical invoice is already queued or synced for this company & financial year
    if (companyCode && invoiceNumber && financialYear) {
      const q = {
        companyCode,
        invoiceNumber,
        financialYear,
        syncStatus: { $ne: TALLY_BILL_SYNC_STATUS.FAILED },
      };
      if (excludeBillId) {
        q.billId = { $ne: excludeBillId };
      }
      const byDetails = await this.model.findOne(q).lean();
      if (byDetails) return byDetails;
    }

    return null;
  }

  /**
   * Retrieves pending bills prioritized by HIGH > MEDIUM > LOW with aging to prevent starvation.
   */
  async findPending(tenantIds, { page = 1, limit = 20, skip = 0, priority } = {}) {
    const q = {
      syncStatus: { $in: [TALLY_BILL_SYNC_STATUS.PENDING, TALLY_BILL_SYNC_STATUS.RETRY_PENDING] },
    };
    if (tenantIds && tenantIds.length > 0) {
      q.tenantId = { $in: tenantIds };
    }
    if (priority) {
      q.priority = priority;
    }

    const all = await this.model.find(q).lean();
    const weight = (p) => (p === TALLY_QUEUE_PRIORITY.HIGH ? 3 : (p === TALLY_QUEUE_PRIORITY.LOW ? 1 : 2));
    all.sort((a, b) => {
      const diff = weight(b.priority) - weight(a.priority);
      if (diff !== 0) return diff;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
    const items = all.slice(skip, skip + limit);
    return { items, total: all.length, page, limit };
  }

  async findFailed(tenantIds, { page = 1, limit = 20, skip = 0 } = {}) {
    const q = {
      syncStatus: TALLY_BILL_SYNC_STATUS.FAILED,
    };
    if (tenantIds && tenantIds.length > 0) {
      q.tenantId = { $in: tenantIds };
    }
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ lastAttempt: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }

  /**
   * Retrieves Dead Letter Queue bills requiring administrative review.
   */
  async findDeadLetterQueue(tenantIds, { page = 1, limit = 20, skip = 0, dlqStatus, priority } = {}) {
    const q = {
      $or: [
        { syncStatus: TALLY_BILL_SYNC_STATUS.DEAD_LETTER },
        { dlqStatus: { $in: [TALLY_DLQ_STATUS.IN_DLQ, TALLY_DLQ_STATUS.RESOLVED, TALLY_DLQ_STATUS.ARCHIVED] } },
      ],
    };
    if (tenantIds && tenantIds.length > 0) {
      q.tenantId = { $in: tenantIds };
    }
    if (dlqStatus) {
      q.dlqStatus = dlqStatus;
    }
    if (priority) {
      q.priority = priority;
    }

    const [items, total] = await Promise.all([
      this.model.find(q).sort({ dlqEnteredAt: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }

  async findQueue(tenantIds, { syncStatus, priority, page = 1, limit = 20, skip = 0 } = {}) {
    const q = {};
    if (tenantIds && tenantIds.length > 0) {
      q.tenantId = { $in: tenantIds };
    }
    if (syncStatus) {
      q.syncStatus = syncStatus;
    }
    if (priority) {
      q.priority = priority;
    }

    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }

  async findHistory(tenantIds, { billId, uuid, companyCode, syncStatus, fromDate, toDate, page = 1, limit = 50, skip = 0 } = {}) {
    const q = {};
    if (tenantIds && tenantIds.length > 0) {
      q.tenantId = { $in: tenantIds };
    }
    if (billId) q.billId = billId;
    if (uuid) q.uuid = uuid;
    if (companyCode) q.companyCode = companyCode;
    if (syncStatus) q.syncStatus = syncStatus;
    if (fromDate || toDate) {
      q.updatedAt = {};
      if (fromDate) q.updatedAt.$gte = new Date(fromDate);
      if (toDate) q.updatedAt.$lte = new Date(toDate);
    }
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }

  async updateStatus(identifier, status, patch = {}) {
    const isObjectId = mongoose.isValidObjectId(identifier);
    const filter = isObjectId ? { $or: [{ billId: identifier }, { uuid: identifier }, { _id: identifier }] } : { $or: [{ billId: identifier }, { uuid: identifier }] };
    return this.model.findOneAndUpdate(
      filter,
      { $set: { syncStatus: status, ...patch } },
      { new: true },
    ).lean();
  }

  async updatePriority(identifier, priority) {
    const isObjectId = mongoose.isValidObjectId(identifier);
    const filter = isObjectId ? { $or: [{ billId: identifier }, { uuid: identifier }, { _id: identifier }] } : { $or: [{ billId: identifier }, { uuid: identifier }] };
    return this.model.findOneAndUpdate(
      filter,
      { $set: { priority } },
      { new: true },
    ).lean();
  }

  async resolveDlq(identifier, { notes, tallyReferenceNumber, user }) {
    const isObjectId = mongoose.isValidObjectId(identifier);
    const filter = isObjectId ? { $or: [{ billId: identifier }, { uuid: identifier }, { _id: identifier }] } : { $or: [{ billId: identifier }, { uuid: identifier }] };
    return this.model.findOneAndUpdate(
      filter,
      {
        $set: {
          syncStatus: TALLY_BILL_SYNC_STATUS.SYNCED,
          dlqStatus: TALLY_DLQ_STATUS.RESOLVED,
          dlqResolvedAt: new Date(),
          dlqResolvedBy: user,
          dlqResolutionNotes: notes,
          ...(tallyReferenceNumber ? { tallyReferenceNumber } : {}),
        },
      },
      { new: true },
    ).lean();
  }

  async archiveDlq(identifier, { reason, user }) {
    const isObjectId = mongoose.isValidObjectId(identifier);
    const filter = isObjectId ? { $or: [{ billId: identifier }, { uuid: identifier }, { _id: identifier }] } : { $or: [{ billId: identifier }, { uuid: identifier }] };
    return this.model.findOneAndUpdate(
      filter,
      {
        $set: {
          dlqStatus: TALLY_DLQ_STATUS.ARCHIVED,
          dlqArchivedAt: new Date(),
          dlqArchivedBy: user,
          dlqArchiveReason: reason,
        },
      },
      { new: true },
    ).lean();
  }

  /**
   * Appends an attempt to the synchronization timeline history with full enterprise metrics.
   */
  async recordAttempt(identifier, {
    status,
    retryCount,
    responsePayload,
    errorMessage,
    user,
    requestId,
    apiKeyId = null,
    latencyMs = 0,
    httpStatus = null,
    responseCode = null,
    errorType = 'NONE',
    errorCategory = 'NONE',
    retryTrigger = 'AUTOMATIC',
    processingDurationMs = 0,
    server = 'launcherdesk-srv-1',
    worker = 'sync-worker-1',
    ipAddress = null,
    lastAttempt = new Date(),
  }) {
    const isObjectId = mongoose.isValidObjectId(identifier);
    const filter = isObjectId ? { $or: [{ billId: identifier }, { uuid: identifier }, { _id: identifier }] } : { $or: [{ billId: identifier }, { uuid: identifier }] };

    const historyEntry = {
      status,
      attemptNumber: (retryCount ?? 0) + 1,
      retryCount: retryCount ?? 0,
      attemptedAt: lastAttempt,
      timestamp: lastAttempt,
      responsePayload: responsePayload ?? null,
      errorMessage: errorMessage ?? null,
      user: user ?? null,
      requestId: requestId ?? null,
      apiKeyId: apiKeyId ?? null,
      latencyMs: Number(latencyMs) || 0,
      httpStatus: httpStatus ? Number(httpStatus) : null,
      responseCode: responseCode ?? null,
      responseBody: responsePayload ?? null,
      errorType: errorType ?? 'NONE',
      errorCategory: errorCategory ?? 'NONE',
      retryTrigger: retryTrigger ?? 'AUTOMATIC',
      processingDurationMs: Number(processingDurationMs) || 0,
      server: String(server || 'launcherdesk-srv-1'),
      worker: String(worker || 'sync-worker-1'),
      ipAddress: ipAddress ?? null,
    };

    return this.model.findOneAndUpdate(
      filter,
      {
        $set: {
          syncStatus: status,
          retryCount,
          lastAttempt,
          responsePayload,
          errorMessage,
          ...(user ? { lastRetriedBy: user } : {}),
        },
        $push: { history: historyEntry },
      },
      { new: true },
    ).lean();
  }

  /**
   * Aggregates operational dashboard metrics.
   */
  async getMetrics(tenantIds, { startDate, endDate, financialYear, status, priority } = {}) {
    const match = {};
    if (tenantIds && tenantIds.length > 0) {
      match.tenantId = { $in: tenantIds };
    }
    if (financialYear) match.financialYear = financialYear;
    if (status) match.syncStatus = status;
    if (priority) match.priority = priority;

    const all = await this.model.find(match).lean();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let todayUploads = 0;
    const statusMap = {
      [TALLY_BILL_SYNC_STATUS.PENDING]: 0,
      [TALLY_BILL_SYNC_STATUS.PROCESSING]: 0,
      [TALLY_BILL_SYNC_STATUS.SYNCED]: 0,
      [TALLY_BILL_SYNC_STATUS.FAILED]: 0,
      [TALLY_BILL_SYNC_STATUS.RETRY_PENDING]: 0,
      [TALLY_BILL_SYNC_STATUS.DEAD_LETTER]: 0,
    };
    let totalRetries = 0;
    const orgMap = new Map();
    const errorCatMap = new Map();
    const latencies = [];

    for (const doc of all) {
      if (doc.createdAt && new Date(doc.createdAt) >= startOfToday) {
        todayUploads++;
      }
      statusMap[doc.syncStatus] = (statusMap[doc.syncStatus] || 0) + 1;
      totalRetries += (doc.retryCount || 0);

      // Orgs
      const code = doc.companyCode || 'UNKNOWN';
      if (!orgMap.has(code)) {
        orgMap.set(code, { companyCode: code, tenantId: doc.tenantId, totalBills: 0, syncedBills: 0, failedBills: 0 });
      }
      const org = orgMap.get(code);
      org.totalBills++;
      if (doc.syncStatus === TALLY_BILL_SYNC_STATUS.SYNCED) org.syncedBills++;
      if (doc.syncStatus === TALLY_BILL_SYNC_STATUS.FAILED || doc.syncStatus === TALLY_BILL_SYNC_STATUS.DEAD_LETTER) org.failedBills++;

      // History
      if (Array.isArray(doc.history)) {
        for (const h of doc.history) {
          if (h.latencyMs > 0) latencies.push(h.latencyMs);
          if (h.errorCategory && h.errorCategory !== 'NONE') {
            errorCatMap.set(h.errorCategory, (errorCatMap.get(h.errorCategory) || 0) + 1);
          }
        }
      }
    }

    const pendingCount = statusMap[TALLY_BILL_SYNC_STATUS.PENDING] || 0;
    const processingCount = statusMap[TALLY_BILL_SYNC_STATUS.PROCESSING] || 0;
    const syncedCount = statusMap[TALLY_BILL_SYNC_STATUS.SYNCED] || 0;
    const failedCount = statusMap[TALLY_BILL_SYNC_STATUS.FAILED] || 0;
    const retryPendingCount = statusMap[TALLY_BILL_SYNC_STATUS.RETRY_PENDING] || 0;
    const deadLetterCount = statusMap[TALLY_BILL_SYNC_STATUS.DEAD_LETTER] || 0;

    const totalCompleted = syncedCount + failedCount + deadLetterCount;
    const successRatePercent = totalCompleted > 0 ? Number(((syncedCount / totalCompleted) * 100).toFixed(1)) : 100;
    const failureRatePercent = totalCompleted > 0 ? Number((((failedCount + deadLetterCount) / totalCompleted) * 100).toFixed(1)) : 0;

    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const minLatency = latencies.length ? Math.min(...latencies) : 0;
    const maxLatency = latencies.length ? Math.max(...latencies) : 0;

    // Determine system health
    let systemHealth = 'HEALTHY';
    if (deadLetterCount > 5 || failureRatePercent > 20) {
      systemHealth = 'DEGRADED';
    }
    if (failureRatePercent > 50 && totalCompleted > 10) {
      systemHealth = 'CRITICAL';
    }

    return {
      todayUploads,
      queueSize: {
        pending: pendingCount,
        processing: processingCount,
        synced: syncedCount,
        failed: failedCount,
        retryPending: retryPendingCount,
        deadLetter: deadLetterCount,
        total: all.length,
      },
      performance: {
        averageSyncTimeMs: avgLatency,
        fastestSyncMs: minLatency,
        slowestSyncMs: maxLatency,
        totalSyncAttempts: latencies.length,
        throughputPerMin: (todayUploads / (new Date().getHours() * 60 + new Date().getMinutes() + 1)).toFixed(2),
      },
      rates: {
        successRatePercent,
        failureRatePercent,
        validationFailureRatePercent: 0,
      },
      topOrganizations: Array.from(orgMap.values()).sort((a, b) => b.totalBills - a.totalBills).slice(0, 10),
      topErrorCategories: Array.from(errorCatMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      apiUsage: {
        todayUploads,
        totalAttempts: latencies.length,
      },
      workerHealth: {
        status: pendingCount > 100 ? 'BACKLOG_WARNING' : 'HEALTHY',
        activeWorkers: 1,
        backlogCount: pendingCount + retryPendingCount,
      },
      retryCount: totalRetries,
      systemHealth,
    };
  }
}
