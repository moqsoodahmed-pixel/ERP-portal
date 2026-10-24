import { Router } from 'express';
import { createTallyHmacAuthMiddleware, requireTallyScope } from '../middlewares/tallyHmacAuth.js';
import { createTallyBillSyncController } from '../controllers/tallyBillSync.controller.js';

export function createTallyBillSyncRouter({ container, limiters }) {
  const { services, repos } = container;

  const tallyHmacAuth = createTallyHmacAuthMiddleware({
    tallyApiKeyRepo: repos.tallyApiKeys,
    tallyApiKeyService: services.tallyApiKeyService,
    authService: services.authService,
    securityService: services.securityService,
    auditService: services.auditService,
    tenantRepo: repos.tenants,
    encryption: services.encryption,
  });

  const controller = createTallyBillSyncController({
    tallyBillSyncService: services.tallyBillSyncService,
    billIntakeService: services.billIntakeService,
    tallyApiKeyService: services.tallyApiKeyService,
    tallyExternalIntegrationService: services.tallyExternalIntegrationService,
    tenantRepo: repos.tenants,
    userRepo: repos.users,
  });

  const router = Router();

  // Apply rate limiter and HMAC / Admin authentication across all dedicated Tally routes
  const rateLimiter = limiters.tallyBillSync || limiters.tallyPublicApi || ((req, res, next) => next());
  router.use(rateLimiter);
  router.use(tallyHmacAuth);

  // Dedicated bill synchronization endpoints with granular scope enforcement
  router.post('/upload', requireTallyScope('Bills.Write'), controller.upload);
  router.post('/retry/:billId', requireTallyScope('Bills.Retry'), controller.retry);
  router.post('/resync/:billId', requireTallyScope('Bills.Sync'), controller.resync);
  router.get('/status/:billId', requireTallyScope('Bills.Read'), controller.status);
  router.get('/pending', requireTallyScope('Bills.Read'), controller.pending);
  router.get('/failed', requireTallyScope('Bills.Read'), controller.failed);
  router.get('/history', requireTallyScope('Bills.Read'), controller.history);
  router.get('/history/:id', requireTallyScope('Bills.Read'), controller.timeline);

  // Dead Letter Queue (DLQ)
  router.get('/dlq', requireTallyScope('Bills.Read'), controller.dlq);
  router.post('/dlq/:id/retry', requireTallyScope('Bills.Retry'), controller.retryDlq);
  router.post('/dlq/:id/resolve', requireTallyScope('Bills.Retry'), controller.resolveDlq);
  router.post('/dlq/:id/archive', requireTallyScope('Bills.Retry'), controller.archiveDlq);
  router.get('/dlq/:id/logs', requireTallyScope('Bills.Export'), controller.dlqLogs);

  // Priority Queue
  router.patch('/queue/:id/priority', requireTallyScope('Bills.Write'), controller.updatePriority);

  // Operational Dashboard
  router.get('/dashboard', requireTallyScope('Bills.Read'), controller.dashboard);

  // Enterprise API Integration Management & Console
  router.get('/integrations/dashboard', controller.dashboardMetrics);
  router.get('/integrations/health', controller.systemHealth);
  router.get('/integrations/logs', controller.liveLogs);
  router.post('/integrations', controller.createIntegration);
  router.get('/integrations', controller.listIntegrations);
  router.patch('/integrations/:id', controller.updateIntegration);
  router.delete('/integrations/:id', controller.deleteIntegration);
  router.post('/integrations/:id/rotate', controller.rotateIntegration);
  router.post('/integrations/:id/disable', controller.disableIntegration);
  router.post('/integrations/:id/enable', controller.enableIntegration);
  router.post('/integrations/:id/revoke', controller.revokeIntegration);

  // Visual API Test Console & Predefined Scenarios
  router.post('/test-console/execute', controller.testConsoleExecute);
  router.post('/test-console/scenario', controller.testConsoleScenario);

  // Administrative credentials setup (backward-compatible)
  router.post('/credentials', controller.createCredentials);
  router.post('/credentials/rotate', controller.rotateCredentials);
  router.post('/credentials/:id/rotate', controller.rotateCredentials);

  return router;
}
