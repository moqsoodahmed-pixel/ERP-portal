import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { makeContext } from '../utils/context.js';
import { ROLES } from '../constants/roles.js';
import { getFinancialYearString } from '../utils/billIdentifier.js';
import { TALLY_QUEUE_PRIORITY } from '../constants/statuses.js';

export function createTallyBillSyncController({
  tallyBillSyncService,
  billIntakeService,
  tallyApiKeyService,
  tallyExternalIntegrationService = null,
  tenantRepo,
  userRepo = null,
}) {
  /**
   * Helper to resolve scoped tenant IDs based on caller's authentication identity.
   */
  const resolveScopedTenants = (req) => {
    const auth = req.tallyAuth;
    if (auth.mode === 'API_KEY') {
      return [auth.tenantId];
    }
    if (auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      if (req.query.tenantId) {
        if (!auth.assignedTenantIds.includes(String(req.query.tenantId))) {
          throw new AuthorizationError('Assistant Admin cannot access organizations outside their assignment');
        }
        return [String(req.query.tenantId)];
      }
      return auth.assignedTenantIds;
    }
    if (auth.role === ROLES.MASTER_ADMIN) {
      if (req.query.tenantId || req.tenantId) {
        return [String(req.query.tenantId || req.tenantId)];
      }
      return null; // All tenants
    }
    throw new AuthorizationError('Unauthorized');
  };

  /**
   * Helper to verify a single bill belongs to caller's scope.
   */
  const verifyBillScope = (req, record) => {
    const auth = req.tallyAuth;
    const recordTenant = String(record.tenantId);
    if (auth.mode === 'API_KEY') {
      if (recordTenant !== auth.tenantId) {
        throw new AuthorizationError('Bill does not belong to the authenticated company');
      }
    } else if (auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      if (!auth.assignedTenantIds.includes(recordTenant)) {
        throw new AuthorizationError('Assistant Admin cannot access organizations outside their assignment');
      }
    }
  };

  return {
    /**
     * POST /api/tally/upload
     * Validates bill document with Validation Engine and initiates non-blocking sync queue entry with UUID.
     */
    upload: asyncHandler(async (req, res) => {
      let tenantId;
      if (req.tallyAuth.mode === 'API_KEY') {
        tenantId = req.tallyAuth.tenantId;
      } else {
        tenantId = req.tenantId || req.body?.tenantId || req.query?.tenantId;
        if (!tenantId) {
          throw new ValidationError('Tenant ID is required for administrative bill upload');
        }
        if (req.tallyAuth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
          if (!req.tallyAuth.assignedTenantIds.includes(String(tenantId))) {
            throw new AuthorizationError('Assistant Admin cannot upload bills for unassigned organizations');
          }
        }
      }

      const tenant = await tenantRepo.findById(tenantId);
      if (!tenant || tenant.isDeleted) throw new NotFoundError('Organization not found');

      let actorId = req.tallyAuth.userId;
      if (!actorId) {
        if (userRepo) {
          const clientAdmin = await userRepo.model.findOne({
            tenantId,
            role: { $in: [ROLES.CLIENT_ADMIN, ROLES.CLIENT_USER] },
            isDeleted: false,
          });
          if (clientAdmin) actorId = clientAdmin._id;
        }
        if (!actorId) {
          actorId = tenant.createdBy || req.tallyAuth.apiKeyId;
        }
      }

      const ctx = {
        tenantId,
        actor: { id: actorId },
        requestId: req.id || req.get('x-request-id') || req.get('x-tally-request-id') || crypto.randomUUID(),
        auth: req.tallyAuth,
      };

      const companyCode = tenant.companyCode || 'CMP001';
      const invoiceNumber = req.body.billNumber || req.body.invoiceNumber;
      const billDate = req.body.billDate ? new Date(req.body.billDate) : (req.body.invoiceDate ? new Date(req.body.invoiceDate) : null);
      const financialYear = billDate && !isNaN(billDate.getTime()) ? getFinancialYearString(billDate) : getFinancialYearString(new Date());
      const amount = req.body.amount !== undefined && req.body.amount !== null && req.body.amount !== ''
        ? Number(req.body.amount)
        : (req.body.totalAmount !== undefined && req.body.totalAmount !== null && req.body.totalAmount !== '' ? Number(req.body.totalAmount) : undefined);
      const gstin = req.body.supplierGstin || req.body.gstin || req.body.vendorGSTIN || '';
      const priority = req.body.priority || TALLY_QUEUE_PRIORITY.MEDIUM;

      const rawBillPayload = {
        tenantId,
        companyCode,
        billNumber: invoiceNumber,
        invoiceNumber,
        billDate,
        financialYear,
        amount,
        taxableAmount: req.body.taxableAmount !== undefined ? Number(req.body.taxableAmount) : undefined,
        cgst: req.body.cgst !== undefined ? Number(req.body.cgst) : undefined,
        sgst: req.body.sgst !== undefined ? Number(req.body.sgst) : undefined,
        igst: req.body.igst !== undefined ? Number(req.body.igst) : undefined,
        taxAmount: Number(req.body.taxAmount || 0),
        supplierName: req.body.supplierName || req.body.vendorName || req.body.partyName,
        vendorName: req.body.supplierName || req.body.vendorName || req.body.partyName,
        supplierGstin: gstin,
        vendorGSTIN: gstin,
        pan: req.body.pan,
        priority,
        documents: req.body.documents || (req.body.documentBase64 ? [{
          data: req.body.documentBase64,
          name: req.body.documentName || 'bill-document.pdf',
          mimeType: req.body.mimeType || 'application/pdf',
        }] : []),
      };

      // 1. DEDICATED VALIDATION ENGINE (Executes BEFORE entering queue)
      if (tallyBillSyncService.validationEngine) {
        const validation = await tallyBillSyncService.validationEngine.validate(rawBillPayload, ctx);
        if (!validation.isValid) {
          const dupError = validation.errors.find((e) => e.rule === 'DUPLICATE_INVOICE' || e.rule === 'DUPLICATE_BILL_ID' || e.code === 'DUPLICATE_INVOICE' || e.code === 'DUPLICATE_BILL_ID');
          if (dupError) {
            throw new ConflictError(
              dupError.message || `Duplicate bill detected for company ${companyCode}`,
              'DUPLICATE_BILL_SYNC',
            );
          }
          return res.status(400).json({
            success: false,
            code: 'VALIDATION_FAILED',
            message: `Bill validation failed with ${validation.errors.length} error(s)`,
            errors: validation.errors,
          });
        }
      }

      // 2. DUPLICATE PREVENTION:
      if (invoiceNumber) {
        const duplicate = await tallyBillSyncService.tallyBillSyncRepo.checkDuplicate({
          companyCode,
          invoiceNumber,
          financialYear,
          gstin,
          amount,
        });

        if (duplicate) {
          throw new ConflictError(
            `Duplicate bill detected: Bill ${duplicate.billId} or Invoice ${invoiceNumber} is already synchronized for company ${companyCode}`,
            'DUPLICATE_BILL_SYNC',
          );
        }
      }

      // 3. Create Bill in Intake
      const bill = await billIntakeService.create(ctx, {
        supplierName: rawBillPayload.supplierName,
        supplierGstin: gstin,
        vendorName: rawBillPayload.vendorName,
        vendorGSTIN: gstin,
        billNumber: invoiceNumber,
        billDate,
        amount,
        taxAmount: rawBillPayload.taxAmount,
        category: req.body.category || 'INVOICE',
        notes: req.body.notes || 'Uploaded via Tally Integration Module',
        documents: rawBillPayload.documents,
        skipTallyQueue: true,
      });

      // 4. Enqueue into Tally Sync Queue with UUID & Priority
      const syncRecord = await tallyBillSyncService.enqueueBill({
        bill: { ...bill, priority },
        tenant,
        user: ctx.actor,
        auth: req.tallyAuth,
        requestId: ctx.requestId,
        autoSync: false,
        priority,
      });

      return res.status(201).json({
        success: true,
        message: 'Bill validated and queued for Tally synchronization',
        uuid: syncRecord.uuid,
        billId: syncRecord.billId,
        companyCode: syncRecord.companyCode,
        priority: syncRecord.priority,
        syncStatus: syncRecord.syncStatus,
        data: {
          ...bill,
          uuid: syncRecord.uuid,
        },
      });
    }),

    /**
     * POST /api/tally/retry/:billId
     * Retries ONLY the specified failed bill.
     */
    retry: asyncHandler(async (req, res) => {
      const identifier = req.params.billId;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const updated = await tallyBillSyncService.retryBill(record.billId, actor);

      return res.json({
        success: true,
        message: `Retry initiated for bill ${record.billId}`,
        uuid: updated.uuid,
        billId: updated.billId,
        syncStatus: updated.syncStatus,
        retryCount: updated.retryCount,
        data: updated,
      });
    }),

    /**
     * POST /api/tally/resync/:billId
     * Forces resynchronization for a single bill.
     */
    resync: asyncHandler(async (req, res) => {
      const identifier = req.params.billId;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const updated = await tallyBillSyncService.resyncBill(record.billId, actor);

      return res.json({
        success: true,
        message: `Resync initiated for bill ${record.billId}`,
        uuid: updated.uuid,
        billId: updated.billId,
        syncStatus: updated.syncStatus,
        data: updated,
      });
    }),

    /**
     * GET /api/tally/status/:billId
     * Returns real-time sync status for a bill by billId or uuid.
     */
    status: asyncHandler(async (req, res) => {
      const identifier = req.params.billId;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const dataPayload = {
        uuid: record.uuid,
        billId: record.billId,
        companyCode: record.companyCode,
        syncStatus: record.syncStatus,
        priority: record.priority,
        dlqStatus: record.dlqStatus,
        retryCount: record.retryCount,
        lastAttempt: record.lastAttempt,
        tallyReferenceNumber: record.tallyReferenceNumber,
        errorMessage: record.errorMessage,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };

      return res.json({
        success: true,
        ...dataPayload,
        data: dataPayload,
      });
    }),

    /**
     * GET /api/tally/pending
     * Lists prioritized pending sync queue.
     */
    pending: asyncHandler(async (req, res) => {
      const tenantIds = resolveScopedTenants(req);
      const result = await tallyBillSyncService.getPendingQueue(tenantIds, {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20),
        priority: req.query.priority,
      });
      return res.json({ success: true, ...result });
    }),

    /**
     * GET /api/tally/failed
     * Lists failed sync queue.
     */
    failed: asyncHandler(async (req, res) => {
      const tenantIds = resolveScopedTenants(req);
      const result = await tallyBillSyncService.getFailedQueue(tenantIds, {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20),
      });
      return res.json({ success: true, ...result });
    }),

    /**
     * GET /api/tally/dlq
     * Lists bills inside Dead Letter Queue requiring review.
     */
    dlq: asyncHandler(async (req, res) => {
      const tenantIds = resolveScopedTenants(req);
      const result = await tallyBillSyncService.getDeadLetterQueue(tenantIds, {
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 20),
        dlqStatus: req.query.dlqStatus,
        priority: req.query.priority,
      });
      return res.json({ success: true, ...result });
    }),

    /**
     * POST /api/tally/dlq/:id/retry
     * Retries a quarantined bill from Dead Letter Queue.
     */
    retryDlq: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const updated = await tallyBillSyncService.retryDlqBill(record.billId, actor);

      return res.json({
        success: true,
        message: `Retry initiated from Dead Letter Queue for bill ${record.billId}`,
        uuid: updated.uuid,
        billId: updated.billId,
        syncStatus: updated.syncStatus,
        data: updated,
      });
    }),

    /**
     * POST /api/tally/dlq/:id/resolve
     * Marks a DLQ bill as resolved via administrative review.
     */
    resolveDlq: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const resolved = await tallyBillSyncService.resolveDlqBill(record.billId, {
        notes: req.body.notes,
        tallyReferenceNumber: req.body.tallyReferenceNumber,
        actor,
      });

      return res.json({
        success: true,
        message: `Bill ${record.billId} marked as resolved in Dead Letter Queue`,
        data: resolved,
      });
    }),

    /**
     * POST /api/tally/dlq/:id/archive
     * Archives an irrecoverable DLQ bill.
     */
    archiveDlq: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`DLQ bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const archived = await tallyBillSyncService.archiveDlqBill(record.billId, {
        reason: req.body.reason,
        actor,
      });

      return res.json({
        success: true,
        message: `Bill ${record.billId} archived from Dead Letter Queue`,
        data: archived,
      });
    }),

    /**
     * GET /api/tally/dlq/:id/logs
     * Exports detailed attempt logs for a DLQ bill.
     */
    dlqLogs: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const timeline = await tallyBillSyncService.getBillHistoryTimeline(record.billId);
      return res.json({ success: true, data: timeline });
    }),

    /**
     * PATCH /api/tally/queue/:id/priority
     * Updates queue priority of a bill (HIGH, MEDIUM, LOW).
     */
    updatePriority: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const priority = req.body.priority;
      if (!priority) throw new ValidationError('Priority is required');

      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const actor = req.tallyAuth.userId ? { id: req.tallyAuth.userId } : { id: `api-key:${req.tallyAuth.apiKeyId || 'tally'}` };
      const updated = await tallyBillSyncService.updatePriority(record.billId, priority, actor);

      return res.json({
        success: true,
        message: `Priority updated to ${priority} for bill ${record.billId}`,
        data: updated,
      });
    }),

    /**
     * GET /api/tally/history
     * Global or scoped synchronization history.
     */
    history: asyncHandler(async (req, res) => {
      const tenantIds = resolveScopedTenants(req);
      const result = await tallyBillSyncService.getHistory(tenantIds, {
        billId: req.query.billId,
        uuid: req.query.uuid,
        companyCode: req.query.companyCode,
        syncStatus: req.query.syncStatus,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 50,
        skip: ((Number(req.query.page) || 1) - 1) * (Number(req.query.limit) || 50),
      });
      return res.json({ success: true, ...result });
    }),

    /**
     * GET /api/tally/history/:id
     * Returns detailed attempt timeline for a single bill.
     */
    timeline: asyncHandler(async (req, res) => {
      const identifier = req.params.id;
      const record = await tallyBillSyncService.tallyBillSyncRepo.findByBillIdOrUuid(identifier);
      if (!record) throw new NotFoundError(`Bill ${identifier} not found`);

      verifyBillScope(req, record);

      const timeline = await tallyBillSyncService.getBillHistoryTimeline(record.billId);
      return res.json({ success: true, data: timeline });
    }),

    /**
     * GET /api/tally/dashboard
     * Operational monitoring dashboard metrics.
     */
    dashboard: asyncHandler(async (req, res) => {
      const tenantIds = resolveScopedTenants(req);
      const metrics = await tallyBillSyncService.getDashboardMetrics(tenantIds, {
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        financialYear: req.query.financialYear,
        status: req.query.status,
        priority: req.query.priority,
      });
      return res.json({ success: true, data: metrics });
    }),

    // ================================================================
    // ENTERPRISE API INTEGRATION MANAGEMENT
    // ================================================================

    /**
     * POST /api/tally/integrations
     * Registers a new external integration with granular permissions.
     */
    createIntegration: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }

      let tenantId;
      if (req.tallyAuth.mode === 'ERP_ADMIN') {
        tenantId = req.body.tenantId || req.tenantId;
        if (!tenantId) throw new ValidationError('Tenant ID is required to register an integration');
        if (req.tallyAuth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
          if (!req.tallyAuth.assignedTenantIds.includes(String(tenantId))) {
            throw new AuthorizationError('Assistant Admin cannot manage integrations for unassigned organizations');
          }
        }
      } else {
        throw new AuthorizationError('Only platform administrators can register external integrations');
      }

      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        requestId: req.id || crypto.randomUUID(),
      };

      const result = await tallyExternalIntegrationService.createIntegration(ctx, {
        name: req.body.name,
        environment: req.body.environment,
        description: req.body.description,
        permissions: req.body.permissions,
        expiresInDays: req.body.expiresInDays !== undefined ? req.body.expiresInDays : 90,
        ipAllowList: req.body.ipAllowList,
        webhookUrl: req.body.webhookUrl,
      });

      return res.status(201).json({
        success: true,
        message: 'Integration registered successfully. Secret key is displayed only once.',
        data: result,
      });
    }),

    /**
     * GET /api/tally/integrations
     * Lists external integrations for organization.
     */
    listIntegrations: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }

      let tenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
      if (req.tallyAuth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
        if (!tenantId) {
          tenantId = req.tallyAuth.assignedTenantIds[0];
        } else if (!req.tallyAuth.assignedTenantIds.includes(String(tenantId))) {
          throw new AuthorizationError('Assistant Admin cannot access integrations for unassigned organizations');
        }
      }
      if (!tenantId && req.tallyAuth.mode === 'API_KEY') {
        tenantId = req.tallyAuth.tenantId;
      }

      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
        allTenants: req.tallyAuth.role === ROLES.MASTER_ADMIN && !tenantId,
      };
      const items = await tallyExternalIntegrationService.listIntegrations(ctx);
      return res.json({ success: true, items });
    }),

    /**
     * GET /api/tally/integrations/dashboard
     * Returns 10 key metric cards for the API Integrations Dashboard.
     */
    dashboardMetrics: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const tenantId = req.query.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const data = await tallyExternalIntegrationService.getDashboardMetrics(ctx);
      return res.json({ success: true, data });
    }),

    /**
     * GET /api/tally/integrations/health
     * Returns visual health indicators (green/amber/red) for the API and queue system.
     */
    systemHealth: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const ctx = {
        tenantId: req.query.tenantId || req.tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const data = await tallyExternalIntegrationService.getSystemHealth(ctx);
      return res.json({ success: true, data });
    }),

    /**
     * GET /api/tally/integrations/logs
     * Returns searchable live API logs with filters.
     */
    liveLogs: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const ctx = {
        tenantId: req.query.organization || req.query.tenantId || req.tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const data = await tallyExternalIntegrationService.getLiveLogs(ctx, req.query);
      return res.json({ success: true, ...data });
    }),

    /**
     * PATCH /api/tally/integrations/:id
     * Updates integration details.
     */
    updateIntegration: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const tenantId = req.body.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.updateIntegration(ctx, req.params.id, req.body);
      return res.json({ success: true, message: 'Integration updated successfully', data: result });
    }),

    /**
     * DELETE /api/tally/integrations/:id
     * Master Admin: full delete access.
     * Assistant Admin: CANNOT delete master integrations.
     */
    deleteIntegration: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const tenantId = req.query.tenantId || req.body?.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.deleteIntegration(ctx, req.params.id);
      return res.json(result);
    }),

    /**
     * POST /api/tally/integrations/:id/rotate
     * Rotates credentials with versioning and 24h grace period.
     */
    rotateIntegration: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }

      let tenantId = req.body.tenantId || req.tenantId;
      if (req.tallyAuth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
        if (!req.tallyAuth.assignedTenantIds.includes(String(tenantId))) {
          throw new AuthorizationError('Assistant Admin cannot manage integrations for unassigned organizations');
        }
      }

      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.rotateIntegration(ctx, req.params.id, {
        gracePeriodHours: req.body.gracePeriodHours !== undefined ? Number(req.body.gracePeriodHours) : 24,
      });

      return res.json({
        success: true,
        message: 'Credentials rotated successfully with migration grace period',
        data: result,
      });
    }),

    /**
     * POST /api/tally/integrations/:id/disable
     */
    disableIntegration: asyncHandler(async (req, res) => {
      const tenantId = req.body.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.disableIntegration(ctx, req.params.id);
      return res.json({ success: true, message: 'Integration disabled', data: result });
    }),

    /**
     * POST /api/tally/integrations/:id/enable
     */
    enableIntegration: asyncHandler(async (req, res) => {
      const tenantId = req.body.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.enableIntegration(ctx, req.params.id);
      return res.json({ success: true, message: 'Integration enabled', data: result });
    }),

    /**
     * POST /api/tally/integrations/:id/revoke
     */
    revokeIntegration: asyncHandler(async (req, res) => {
      const tenantId = req.body.tenantId || req.tenantId;
      const ctx = {
        tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.revokeIntegration(ctx, req.params.id);
      return res.json({ success: true, message: 'Integration revoked', data: result });
    }),

    /**
     * POST /api/tally/test-console/execute
     * Visual API Test Console execution runner.
     */
    testConsoleExecute: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const ctx = {
        tenantId: req.body.tenantId || req.tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.executeApiTest(ctx, req.body);
      return res.json({ success: true, data: result });
    }),

    /**
     * POST /api/tally/test-console/scenario
     * 1-Click execution runner for predefined test scenarios.
     */
    testConsoleScenario: asyncHandler(async (req, res) => {
      if (!tallyExternalIntegrationService) {
        throw new ValidationError('Integration Management service not configured');
      }
      const { scenarioKey, integrationId } = req.body;
      if (!scenarioKey) throw new ValidationError('scenarioKey is required');

      const ctx = {
        tenantId: req.body.tenantId || req.tenantId,
        actor: { id: req.tallyAuth.userId },
        actorRole: req.tallyAuth.role,
        assignedTenantIds: req.tallyAuth.assignedTenantIds,
      };
      const result = await tallyExternalIntegrationService.runPredefinedScenario(ctx, scenarioKey, integrationId);
      return res.json({ success: true, data: result });
    }),

    // Legacy credential endpoints for backward compatibility
    createCredentials: asyncHandler(async (req, res) => {
      let tenantId = req.body?.tenantId || req.tenantId;
      if (!tenantId) throw new ValidationError('Tenant ID is required');

      const ctx = { tenantId, actor: { id: req.tallyAuth.userId } };
      const creds = await tallyApiKeyService.create(ctx, {
        name: req.body.name || 'Tally Sync Key',
        scopes: ['tally:bill:sync'],
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
        ipAllowList: req.body.ipAllowList || [],
      });
      return res.status(201).json({
        success: true,
        message: 'Tally API Key and Secret generated successfully',
        data: creds,
      });
    }),

    rotateCredentials: asyncHandler(async (req, res) => {
      const { apiKeyId } = req.body;
      if (!apiKeyId) throw new ValidationError('apiKeyId is required for rotation');
      const tenantId = req.body?.tenantId || req.tenantId;
      const ctx = { tenantId, actor: { id: req.tallyAuth.userId } };
      const rotated = await tallyApiKeyService.rotate(ctx, apiKeyId);
      return res.json({
        success: true,
        message: 'Tally credentials rotated successfully',
        data: rotated,
      });
    }),
  };
}
