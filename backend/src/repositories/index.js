import {
  UserRepository, TenantsRepository, VendorRepository, AssignmentRepository, RoleRepository, UserRoleRepository,
} from './identity.repositories.js';
import {
  ProductRepository, CustomerRepository, InvoiceRepository, BusinessProfileRepository,
  TallyIntegrationRepository, TallySyncRepository, GSTFilingRepository, GSTFilingIssueRepository, TallyApiKeyRepository,
  BillIntakeRepository, TallyConnectorRepository, TallyJobRepository,
} from './business.repositories.js';
import {
  AuditRepository, RefreshTokenRepository, SecurityEventRepository, CounterRepository, IdempotencyRepository, NotificationRepository,
  FileMetadataRepository,
} from './platform.repositories.js';
import { DocumentRepository } from './document.repository.js';
import { ReportRepository } from './report.repository.js';

export function buildRepositories(m) {
  return {
    users: new UserRepository(m.User),
    tenants: new TenantsRepository(m.Tenant),
    vendors: new VendorRepository(m.Vendor),
    assignments: new AssignmentRepository(m.VendorClientAssignment),
    roles: new RoleRepository(m.Role),
    userRoles: new UserRoleRepository(m.UserRole),
    businessProfiles: new BusinessProfileRepository(m.BusinessProfile),
    products: new ProductRepository(m.Product),
    customers: new CustomerRepository(m.Customer),
    invoices: new InvoiceRepository(m.Invoice),
    tallyIntegrations: new TallyIntegrationRepository(m.TallyIntegration),
    tallySyncs: new TallySyncRepository(m.TallySyncLog),
    gstFilings: new GSTFilingRepository(m.GSTFiling),
    gstFilingIssues: new GSTFilingIssueRepository(m.GSTFilingIssue),
    tallyApiKeys: new TallyApiKeyRepository(m.TallyApiKey),
    audit: new AuditRepository(m.AuditLog),
    refreshTokens: new RefreshTokenRepository(m.RefreshToken),
    securityEvents: new SecurityEventRepository(m.SecurityEvent),
    counters: new CounterRepository(m.Counter),
    idempotency: new IdempotencyRepository(m.IdempotencyKey),
    documents: new DocumentRepository(m.Document),
    notifications: new NotificationRepository(m.Notification),
    reports: new ReportRepository(m),
    bills: new BillIntakeRepository(m.BillIntake),
    tallyConnectors: new TallyConnectorRepository(m.TallyConnector),
    tallyJobs: new TallyJobRepository(m.TallyJob),
    fileMetadata: new FileMetadataRepository(m.FileMetadata),
  };
}
