import { buildRepositories } from './repositories/index.js';
import { AuditService } from './audit/audit.service.js';
import { SecurityEventService } from './audit/securityEvent.service.js';
import { PermissionService } from './services/permission.service.js';
import { AuthService } from './services/auth.service.js';
import { ClientService } from './services/client.service.js';
import { UserService } from './services/user.service.js';
import { ProductService, CustomerService } from './services/catalog.services.js';
import { BusinessProfileService } from './services/businessProfile.service.js';
import { InvoiceService } from './services/invoice.service.js';
import { InvoiceCalculationService } from './services/invoiceCalculation.service.js';
import { CreditDebitNoteService } from './services/creditDebitNote.service.js';
import { VendorService } from './services/vendor.service.js';
import { GSTFilingService } from './services/gstFiling.service.js';
import { GSTBillService } from './services/gstBill.service.js';
import { GSTBillMatchingService } from './services/gstBillMatching.service.js';
import { TallyConfigService, TallySyncService } from './integrations/tally/tally.service.js';
import { TallyAdapter } from './integrations/tally/tally.adapter.js';
import { TallyClient } from './integrations/tally/tally.client.js';
import { TallyMapper } from './integrations/tally/tally.mapper.js';
import { TallyApiKeyService } from './integrations/tally/tallyApiKey.service.js';
import { TallyPublicApiService } from './integrations/tally/tallyPublicApi.service.js';
import { EncryptionService } from './security/encryption.js';
import { createStorageService } from './services/storage.service.js';
import { InvoicePdfService } from './services/invoicePdf.service.js';
import { DocumentService } from './services/document.service.js';
import { NotificationService } from './services/notification.service.js';
import { ReportService } from './services/report.service.js';
import { DashboardService } from './services/dashboard.service.js';
import { BillIntakeService } from './services/billIntake.service.js';
import { TallyConnectorService } from './integrations/tally/tallyConnector.service.js';
import { TallyJobService } from './integrations/tally/tallyJob.service.js';
import { TallyBillSyncService } from './integrations/tally/tallyBillSync.service.js';
import { TallyValidationEngine } from './integrations/tally/tallyValidationEngine.js';
import { TallyExternalIntegrationService } from './integrations/tally/tallyExternalIntegration.service.js';
import { env } from './config/env.js';

/** Composition root: the only place where concrete classes are wired together. Tests inject fake models here. */
export function buildContainer(models) {
  const repos = buildRepositories(models);
  const auditService = new AuditService({ auditRepo: repos.audit });
  const securityService = new SecurityEventService({ securityRepo: repos.securityEvents });
  const permissionService = new PermissionService({ roleRepo: repos.roles, userRoleRepo: repos.userRoles });
  const calculator = new InvoiceCalculationService();
  const storageService = createStorageService(env);
  const invoicePdfService = new InvoicePdfService();
  // Phase 9: single injected notification generator shared by every service that owns a notifying transition.
  const notificationService = new NotificationService({ notificationRepo: repos.notifications, userRepo: repos.users, assignmentRepo: repos.assignments });
  const invoiceService = new InvoiceService({
    invoiceRepo: repos.invoices, customerRepo: repos.customers, productRepo: repos.products, counterRepo: repos.counters, calculator, auditService,
    businessProfileRepo: repos.businessProfiles, notificationService,
  });
  const documentService = new DocumentService({
    documentRepo: repos.documents, storageService, pdfService: invoicePdfService, auditService, fileMetadataRepo: repos.fileMetadata,
  });
  const creditDebitNoteService = new CreditDebitNoteService({
    noteRepo: repos.creditDebitNotes, invoiceRepo: repos.invoices, productRepo: repos.products, counterRepo: repos.counters, calculator, auditService,
  });
  const services = {
    auditService, securityService, permissionService, invoiceService, documentService, notificationService, creditDebitNoteService,
    authService: new AuthService({
      userRepo: repos.users, tenantRepo: repos.tenants, vendorRepo: repos.vendors, refreshRepo: repos.refreshTokens, auditService, securityService, permissionService,
    }),
    clientService: new ClientService({
      tenantRepo: repos.tenants, userRepo: repos.users, counterRepo: repos.counters, auditService, assignmentRepo: repos.assignments, vendorRepo: repos.vendors,
      notificationService,
    }),
    userService: new UserService({ userRepo: repos.users, auditService }),
    businessProfileService: new BusinessProfileService({
      businessProfileRepo: repos.businessProfiles, fileMetadataRepo: repos.fileMetadata, storageService, auditService, pdfService: invoicePdfService,
    }),
    productService: new ProductService({ productRepo: repos.products, counterRepo: repos.counters, auditService }),
    customerService: new CustomerService({ customerRepo: repos.customers, counterRepo: repos.counters, auditService }),
    vendorService: new VendorService({
      vendorRepo: repos.vendors, userRepo: repos.users, tenantRepo: repos.tenants, assignmentRepo: repos.assignments, invoiceService, counterRepo: repos.counters, auditService,
      notificationService,
    }),
    gstFilingService: new GSTFilingService({
      gstFilingRepo: repos.gstFilings, gstFilingIssueRepo: repos.gstFilingIssues, tenantRepo: repos.tenants, userRepo: repos.users,
      assignmentRepo: repos.assignments, invoiceRepo: repos.invoices, tallySyncRepo: repos.tallySyncs, businessProfileRepo: repos.businessProfiles, auditService,
      notificationService, gstBillRepo: repos.gstBills, gstBillMatchRepo: repos.gstBillMatches,
    }),
    gstBillService: new GSTBillService({
      gstBillRepo: repos.gstBills, fileMetadataRepo: repos.fileMetadata, storageService, auditService,
      assignmentRepo: repos.assignments, businessProfileRepo: repos.businessProfiles, tenantRepo: repos.tenants,
      gstBillMatchRepo: repos.gstBillMatches,
    }),
  };
  services.reportService = new ReportService({ reportRepo: repos.reports, auditService, gstFilingService: services.gstFilingService });
  services.dashboardService = new DashboardService({
    reportService: services.reportService, reportRepo: repos.reports, clientService: services.clientService,
    assignmentRepo: repos.assignments, tenantRepo: repos.tenants, securityEventRepo: repos.securityEvents,
  });
  const encryption = (() => { try { return new EncryptionService(); } catch { return null; } })();
  const tallyAdapter = new TallyAdapter({ client: new TallyClient(), mapper: new TallyMapper() });
  services.encryption = encryption;
  services.tallyConfigService = new TallyConfigService({ integrationRepo: repos.tallyIntegrations, adapter: tallyAdapter, encryption, auditService });
  services.tallySyncService = new TallySyncService({
    syncRepo: repos.tallySyncs, integrationRepo: repos.tallyIntegrations, adapter: tallyAdapter, invoiceService, auditService, encryption, notificationService,
  });
  // Phase 20: GST Bill <-> Tally bill-by-bill matching. Reuses the SAME TallyIntegration config/adapter/
  // encryption as the invoice sync path above — no second Tally connection system.
  services.gstBillMatchingService = new GSTBillMatchingService({
    gstBillRepo: repos.gstBills, gstBillMatchRepo: repos.gstBillMatches, tallyIntegrationRepo: repos.tallyIntegrations,
    tallyAdapter, encryption, auditService,
  });
  // Phase 13: Tally Public API (Tally/TDL -> ERP direction). tallyApiKeyService owns key lifecycle +
  // authentication; tallyPublicApiService is a thin projection over the SAME services every JWT-authenticated
  // route already uses (no duplicated business/GST/sync logic).
  services.tallyApiKeyService = new TallyApiKeyService({ tallyApiKeyRepo: repos.tallyApiKeys, auditService, securityService, encryption });
  services.tallyPublicApiService = new TallyPublicApiService({
    businessProfileService: services.businessProfileService, productService: services.productService,
    customerService: services.customerService, invoiceService, tallySyncService: services.tallySyncService,
  });
  // Phase 15: bill intake + Tally queue. Reuses the same storage service as invoice PDFs (Phase 5) — no
  // second file-storage system — and the same notificationService/auditService every other workflow uses.
  // Phase 16: Tally Connector bridge. tallyConnectorService owns connector credential lifecycle (its own,
  // third authentication system — see tallyConnectorAuth.js); tallyJobService owns the TallyJob queue and
  // calls BACK into billIntakeService's existing tallyProcessingStarted/tallySynced/tallyFailed/tallyRetry
  // methods rather than duplicating the Phase 15 status machine. billIntakeService is constructed with a
  // tallyJobHook closure so bill->job creation stays a one-way dependency (billIntakeService has no
  // import-time knowledge of the Tally Connector bridge).
  services.tallyConnectorService = new TallyConnectorService({
    tallyConnectorRepo: repos.tallyConnectors, tallyIntegrationRepo: repos.tallyIntegrations, auditService, securityService, notificationService,
  });
  const tallyValidationEngine = new TallyValidationEngine({
    tenantRepo: repos.tenants,
    tallyBillSyncRepo: repos.tallyBillSyncs,
    billRepo: repos.bills,
  });
  services.tallyValidationEngine = tallyValidationEngine;
  services.tallyBillSyncService = new TallyBillSyncService({
    tallyBillSyncRepo: repos.tallyBillSyncs,
    billRepo: repos.bills,
    tenantRepo: repos.tenants,
    tallyIntegrationRepo: repos.tallyIntegrations,
    tallyAdapter,
    validationEngine: tallyValidationEngine,
    auditService,
    notificationService,
  });
  services.tallyExternalIntegrationService = new TallyExternalIntegrationService({
    tallyApiKeyRepo: repos.tallyApiKeys,
    auditService,
    securityService,
    encryption,
    notificationService,
    tallyBillSyncService: services.tallyBillSyncService,
    tallyValidationEngine,
    tenantRepo: repos.tenants,
    auditRepo: repos.audit,
  });
  services.billIntakeService = new BillIntakeService({
    billRepo: repos.bills, fileMetadataRepo: repos.fileMetadata, storageService, userRepo: repos.users,
    assignmentRepo: repos.assignments, tenantRepo: repos.tenants, auditService, notificationService,
    tallyJobHook: (ctx, bill) => services.tallyJobService.createForBill(ctx, bill),
    counterRepo: repos.counters,
    tallyBillSyncService: services.tallyBillSyncService,
  });
  services.tallyJobService = new TallyJobService({
    tallyJobRepo: repos.tallyJobs, billRepo: repos.bills, tallyIntegrationRepo: repos.tallyIntegrations,
    tallyConnectorRepo: repos.tallyConnectors, billIntakeService: services.billIntakeService, auditService, notificationService,
  });
  return { repos, services };
}
