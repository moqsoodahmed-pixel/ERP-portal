import { Router } from 'express';
import { validate } from '../middlewares/validate.js';
import { idempotency } from '../services/idempotency.service.js';
import { listQuery, idParams, objectIdSchema } from '../validators/common.js';
import { loginBody, changePasswordBody } from '../validators/auth.validators.js';
import * as v from '../validators/resource.validators.js';
import * as gf from '../validators/gstFiling.validators.js';
import { gstBillSave, gstBillDocumentsUpload, gstFinalDocumentUpload } from '../validators/gstBill.validators.js';
import { tallyConfigBody } from '../integrations/tally/tally.validators.js';
import { tallyApiKeyCreateBody } from '../validators/tallyApiKey.validators.js';
import {
  billCreate, billUpdate, billReject, billListQuery, tallyQueueQuery, billDocumentsUpload, billTallySynced, billTallyFailed,
} from '../validators/billIntake.validators.js';
import { createTallyApiAuthMiddlewares } from '../middlewares/tallyApiAuth.js';
import { createTallyConnectorAuthMiddlewares } from '../middlewares/tallyConnectorAuth.js';
import {
  tallyConnectorRegisterBody, tallyConnectorHeartbeatBody, tallyJobResultBody,
} from '../validators/tallyConnector.validators.js';
import { ROLES } from '../constants/roles.js';
import { z } from 'zod';

import { createAuthController } from '../controllers/auth.controller.js';
import {
  createClientController, createUserController, createProductController, createCustomerController, createInvoiceController,
  createVendorController, createAuditController, createTallyController, createBusinessProfileController, notImplemented,
} from '../controllers/resource.controllers.js';
import { createGSTFilingController } from '../controllers/gstFiling.controller.js';
import { createGSTBillController } from '../controllers/gstBill.controller.js';
import { createGSTBillMatchingController } from '../controllers/gstBillMatching.controller.js';
import { createBillIntakeController } from '../controllers/billIntake.controller.js';
import { createDashboardController, createReportController, createNotificationController } from '../controllers/insights.controllers.js';
import { createTallyApiKeyController } from '../controllers/tallyApiKey.controller.js';
import { createTallyPublicApiController } from '../controllers/tallyPublicApi.controller.js';
import { createTallyConnectorController, createTallyConnectorApiController } from '../controllers/tallyConnector.controller.js';
import {
  dashboardQuery, reportQuery, masterReportQuery, reportTypeParams, notificationListQuery,
} from '../validators/report.validators.js';
import { NotFoundError } from '../utils/errors.js';

const auditQuery = listQuery.extend({ tenantId: objectIdSchema.optional(), actorId: objectIdSchema.optional(), action: z.string().max(60).optional() });

export function createV1Router({ container, access, limiters }) {
  const { services, repos } = container;
  const {
    authenticate, requirePermission: can, requireRole, resolveTenant, requireVendorAssignment, resolveTenantForInvoice,
    resolveTenantForFiling, resolveTenantForFilingCreate, resolveTenantForBill,
  } = access;
  const r = Router();
  const tenantScoped = (...perms) => [authenticate, resolveTenant, can(...perms)];
  // Phase 9: report access = reports.view (or reports.export) PLUS the underlying module permission(s) of the
  // requested report type (e.g. invoice-summary also needs invoices.view). Unknown types 404 before any data access.
  const reportDefs = services.reportService.definitions;
  const reportPerms = (exportMode, { crossTenantOnly = false } = {}) => (req, res, next) => {
    const def = reportDefs[req.params.type];
    if (!def || (crossTenantOnly && !def.crossTenant)) return next(new NotFoundError('Unknown report'));
    return can(exportMode ? 'reports.export' : 'reports.view', ...def.permissions)(req, res, next);
  };
  // The ONLY places a report scope is built: from server-resolved req.tenantId, or (Master-only routes) platform-wide.
  const tenantReportScope = (req) => ({ tenantIds: [String(req.tenantId)] });
  const masterReportScope = (req) => (req.query.clientId ? { tenantIds: [String(req.query.clientId)] } : { allTenants: true });
  const dashboards = createDashboardController(services);
  const tenantReports = createReportController(services, tenantReportScope);
  const masterReports = createReportController(services, masterReportScope, { crossTenantOnly: true });
  // Same as tenantScoped, but also allows GST_VENDOR access to a single invoice when an ACTIVE assignment
  // to that invoice's own tenant exists (verified server-side from the invoice record, never the URL).
  const invoiceScoped = (...perms) => [authenticate, resolveTenantForInvoice, can(...perms)];

  // ---- auth
  const auth = createAuthController(services);
  const authRouter = Router();
  authRouter.post('/login', limiters.login, validate({ body: loginBody }), auth.login);
  authRouter.post('/refresh', limiters.refresh, auth.refresh);
  authRouter.post('/logout', auth.logout);
  authRouter.get('/me', authenticate, auth.me);
  authRouter.post('/change-password', limiters.passwordReset, authenticate, validate({ body: changePasswordBody }), auth.changePassword);
  r.use('/auth', authRouter);

  // ---- clients (Master Admin only; platform-level)
  const clients = createClientController(services);
  const vendors = createVendorController(services);
  const clientRouter = Router();
  // Vendor view of an assigned client's invoices (requires an ACTIVE assignment; everyone else gets 403).
  clientRouter.get('/:tenantId/invoices', authenticate, requireVendorAssignment('tenantId'), can('invoices.view'),
    validate({ params: z.object({ tenantId: objectIdSchema }), query: listQuery }), vendors.clientInvoices);
  // Client Admin's read-only view of the vendor(s) assigned to THEIR OWN tenant (tenantId is server-derived, not the URL param).
  clientRouter.get('/:tenantId/vendors', authenticate, resolveTenant, can('business.view'),
    validate({ params: z.object({ tenantId: objectIdSchema }) }), vendors.clientVendors);
  clientRouter.use(authenticate, requireRole(ROLES.MASTER_ADMIN));
  clientRouter.get('/stats', can('clients.view'), clients.stats);
  clientRouter.get('/', can('clients.view'), validate({ query: v.clientListQuery }), clients.list);
  clientRouter.post('/', can('clients.create'), validate({ body: v.clientCreate }), clients.create);
  clientRouter.get('/:id', can('clients.view'), validate({ params: idParams }), clients.get);
  clientRouter.patch('/:id', can('clients.update'), validate({ params: idParams, body: v.clientUpdate }), clients.update);
  clientRouter.patch('/:id/status', can('clients.update'), validate({ params: idParams, body: v.clientStatus }), clients.setStatus);
  clientRouter.get('/:id/summary', can('clients.view'), validate({ params: idParams }), clients.summary);
  r.use('/clients', clientRouter);

  // ---- master dashboard (Master Admin only; platform-level aggregates, no fake financial data)
  const masterRouter = Router();
  masterRouter.use(authenticate, requireRole(ROLES.MASTER_ADMIN));
  // Phase 9 extends (not replaces) the Phase 2 response: same route, same Phase 2 fields, plus filing/Tally/security aggregates.
  masterRouter.get('/dashboard', can('platform.view'), validate({ query: dashboardQuery }), dashboards.master);
  // Cross-tenant reports (filing status / filing issues only). Master Admin role is enforced by masterRouter.use above.
  masterRouter.get('/reports', can('reports.view'), masterReports.catalog);
  masterRouter.get('/reports/:type', validate({ params: reportTypeParams, query: masterReportQuery }), reportPerms(false, { crossTenantOnly: true }), masterReports.run);
  masterRouter.get('/reports/:type/export', validate({ params: reportTypeParams, query: masterReportQuery }), reportPerms(true, { crossTenantOnly: true }), masterReports.exportCsv);
  r.use('/master', masterRouter);

  // ---- client dashboard (Phase 9; tenant from resolveTenant — own tenant, or Master Admin's audited header)
  r.get('/dashboard', ...tenantScoped('dashboard.view'), validate({ query: dashboardQuery }), dashboards.client);

  // ---- users (tenant scoped)
  const users = createUserController(services);
  r.get('/users', ...tenantScoped('users.view'), validate({ query: listQuery }), users.list);
  r.post('/users', ...tenantScoped('users.create'), validate({ body: v.userCreate }), users.create);
  r.patch('/users/:id', ...tenantScoped('users.update'), validate({ params: idParams, body: v.userUpdate }), users.update);

  // ---- business profile (one per tenant)
  const businessProfile = createBusinessProfileController(services);
  r.get('/business-profile', ...tenantScoped('business.view'), businessProfile.get);
  r.post('/business-profile', ...tenantScoped('business.update'), validate({ body: v.businessProfileCreate }), businessProfile.create);
  r.patch('/business-profile', ...tenantScoped('business.update'), validate({ body: v.businessProfileUpdate }), businessProfile.update);
  r.get('/business-profile/logo', ...tenantScoped('business.view'), businessProfile.getLogo);
  r.post('/business-profile/logo', ...tenantScoped('business.update'), validate({ body: v.businessProfileLogoUpload }), businessProfile.uploadLogo);
  r.delete('/business-profile/logo', ...tenantScoped('business.update'), businessProfile.removeLogo);

  // ---- products / customers
  const products = createProductController(services);
  r.get('/products', ...tenantScoped('products.view'), validate({ query: listQuery }), products.list);
  r.post('/products', ...tenantScoped('products.create'), validate({ body: v.productCreate }), products.create);
  r.get('/products/:id', ...tenantScoped('products.view'), validate({ params: idParams }), products.get);
  r.patch('/products/:id', ...tenantScoped('products.update'), validate({ params: idParams, body: v.productUpdate }), products.update);
  r.delete('/products/:id', ...tenantScoped('products.delete'), validate({ params: idParams }), products.archive);

  const customers = createCustomerController(services);
  r.get('/customers', ...tenantScoped('customers.view'), validate({ query: listQuery }), customers.list);
  r.post('/customers', ...tenantScoped('customers.create'), validate({ body: v.customerCreate }), customers.create);
  r.get('/customers/:id', ...tenantScoped('customers.view'), validate({ params: idParams }), customers.get);
  r.patch('/customers/:id', ...tenantScoped('customers.update'), validate({ params: idParams, body: v.customerUpdate }), customers.update);
  r.delete('/customers/:id', ...tenantScoped('customers.delete'), validate({ params: idParams }), customers.archive);

  // ---- invoices
  const invoices = createInvoiceController({ invoiceService: services.invoiceService, documentService: services.documentService });
  r.get('/invoices', ...tenantScoped('invoices.view'), validate({ query: listQuery }), invoices.list);
  // Phase 9: the former 501 placeholder now streams the invoice-summary report as CSV (same engine, same row cap, audited).
  r.get('/invoices/export', ...tenantScoped('invoices.export'), validate({ query: reportQuery }), (req, res, next) => { req.params.type = 'invoice-summary'; next(); }, tenantReports.exportCsv);
  r.post('/invoices', ...tenantScoped('invoices.create'), idempotency(repos.idempotency, 'invoices.create'), validate({ body: v.invoiceCreate }), invoices.create);
  r.get('/invoices/:id', ...invoiceScoped('invoices.view'), validate({ params: idParams }), invoices.get);
  r.patch('/invoices/:id', ...tenantScoped('invoices.update'), validate({ params: idParams, body: v.invoiceUpdate }), invoices.update);
  r.post('/invoices/:id/issue', ...tenantScoped('invoices.issue'), validate({ params: idParams }), invoices.issue);
  r.post('/invoices/:id/cancel', ...tenantScoped('invoices.cancel'), validate({ params: idParams, body: v.invoiceCancel }), invoices.cancel);
  r.get('/invoices/:id/pdf', ...invoiceScoped('invoices.view'), validate({ params: idParams }), invoices.viewPdf);
  r.post('/invoices/:id/pdf', ...tenantScoped('invoices.update'), validate({ params: idParams }), invoices.regeneratePdf);

  // ---- vendors
  const gstBills = createGSTBillController({ gstBillService: services.gstBillService });
  const vendorRouter = Router();
  vendorRouter.get('/me/clients', authenticate, requireRole(ROLES.GST_VENDOR), can('gst.view'), vendors.myClients);
  // Phase 9: server-side vendor dashboard (assigned tenant set derived from the vendor's own ACTIVE assignments only).
  vendorRouter.get('/me/dashboard', authenticate, requireRole(ROLES.GST_VENDOR), can('dashboard.view'), dashboards.vendor);
  // Phase 9: vendor reports for ONE assigned client — the exact Phase 7 requireVendorAssignment chain, then report permissions.
  vendorRouter.get('/me/clients/:tenantId/reports/:type', authenticate, requireVendorAssignment('tenantId'),
    validate({ params: z.object({ tenantId: objectIdSchema }).extend(reportTypeParams.shape), query: reportQuery }), reportPerms(false), tenantReports.run);
  vendorRouter.get('/me/clients/:tenantId/invoices', authenticate, requireVendorAssignment('tenantId'), can('invoices.view'),
    validate({ params: z.object({ tenantId: objectIdSchema }), query: listQuery }), vendors.clientInvoices);
  // Phase 19.3: read-only, cross-tenant GST Bill handoff view — tenant set is derived ONLY from the vendor's
  // own ACTIVE assignments (assignmentRepo), never from any id the frontend could supply.
  vendorRouter.get('/me/gst-bills', authenticate, requireRole(ROLES.GST_VENDOR), can('gst_bills.view'), validate({ query: listQuery }), gstBills.vendorList);
  vendorRouter.use(authenticate, requireRole(ROLES.MASTER_ADMIN));
  vendorRouter.get('/', can('vendors.view'), validate({ query: listQuery }), vendors.list);
  vendorRouter.post('/', can('vendors.create'), validate({ body: v.vendorCreate }), vendors.create);
  vendorRouter.get('/:vendorId', can('vendors.view'), validate({ params: z.object({ vendorId: objectIdSchema }) }), vendors.get);
  vendorRouter.patch('/:vendorId', can('vendors.update'), validate({ params: z.object({ vendorId: objectIdSchema }), body: v.vendorUpdate }), vendors.update);
  vendorRouter.get('/:vendorId/assignments', can('vendors.view'), validate({ params: z.object({ vendorId: objectIdSchema }) }), vendors.listAssignments);
  vendorRouter.post('/:vendorId/assignments', can('vendors.assign'), validate({ params: z.object({ vendorId: objectIdSchema }), body: v.assignmentCreate }), vendors.assign);
  vendorRouter.patch('/:vendorId/assignments/:assignmentId', can('vendors.assign'),
    validate({ params: z.object({ vendorId: objectIdSchema, assignmentId: objectIdSchema }), body: v.assignmentLifecycle }), vendors.assignmentLifecycle);
  vendorRouter.delete('/:vendorId/assignments/:tenantId', can('vendors.assign'), validate({ params: z.object({ vendorId: objectIdSchema, tenantId: objectIdSchema }) }), vendors.unassign);
  r.use('/vendors', vendorRouter);

  // ---- GST filing WORKFLOW TRACKER (Phase 8) — ERP-internal progress/issue tracking only; NOT a GST
  // portal/GSTN integration. Every :id route re-verifies the full tenant/vendor-assignment chain via
  // resolveTenantForFiling (same invariant as Phase 7's invoice routes), never trusting the URL alone.
  const gstFilings = createGSTFilingController({ gstFilingService: services.gstFilingService });
  const gstBillMatching = createGSTBillMatchingController({ gstBillMatchingService: services.gstBillMatchingService });
  const filingRouter = Router();
  filingRouter.use(authenticate);
  filingRouter.get('/', can('gst_filings.view'), validate({ query: gf.filingListQuery }), gstFilings.list);
  // Phase 22 — read-only GST Filing workspace tracker (must precede '/:id' below so "progress" is never
  // matched as a filing id). Client-only (service enforces CLIENT_ADMIN/CLIENT_USER); no write path.
  filingRouter.get('/progress', can('gst_filings.view'), gstFilings.progress);
  filingRouter.post('/', can('gst_filings.create'), resolveTenantForFilingCreate, validate({ body: gf.filingCreate }), gstFilings.create);
  filingRouter.get('/:id', resolveTenantForFiling, can('gst_filings.view'), validate({ params: idParams }), gstFilings.get);
  filingRouter.patch('/:id', resolveTenantForFiling, can('gst_filings.update'), validate({ params: idParams, body: gf.filingUpdate }), gstFilings.update);
  filingRouter.post('/:id/start', resolveTenantForFiling, can('gst_filings.update'), validate({ params: idParams }), gstFilings.start);
  filingRouter.post('/:id/ready', resolveTenantForFiling, can('gst_filings.update'), validate({ params: idParams }), gstFilings.ready);
  filingRouter.post('/:id/submit', resolveTenantForFiling, can('gst_filings.submit'), validate({ params: idParams }), gstFilings.submit);
  filingRouter.post('/:id/mark-filed', resolveTenantForFiling, can('gst_filings.mark_filed'), validate({ params: idParams }), gstFilings.markFiled);
  filingRouter.get('/:id/issues', resolveTenantForFiling, can('gst_filing_issues.view'), validate({ params: idParams }), gstFilings.listIssues);
  filingRouter.post('/:id/issues', resolveTenantForFiling, can('gst_filing_issues.create'), validate({ params: idParams, body: gf.issueCreate }), gstFilings.createIssue);
  filingRouter.patch('/:id/issues/:issueId', resolveTenantForFiling, can('gst_filing_issues.update'),
    validate({ params: idParams.extend({ issueId: objectIdSchema }), body: gf.issueUpdate }), gstFilings.updateIssue);

  // ---- GST Bill Builder (Phase 19) — a simple bill tied 1:1 to the filing above (serial/productName/rate
  // line items + flat 18% GST), reusing the SAME resolveTenantForFiling ownership chain as every other
  // :id route on this router, so a filingId never grants access to another tenant's filing/bill.
  filingRouter.get('/:id/bill', resolveTenantForFiling, can('gst_bills.view'), validate({ params: idParams }), gstBills.get);
  filingRouter.put('/:id/bill', resolveTenantForFiling, can('gst_bills.update'), validate({ params: idParams, body: gstBillSave }), gstBills.save);
  filingRouter.post('/:id/bill/documents', resolveTenantForFiling, can('gst_bills.update'), validate({ params: idParams, body: gstBillDocumentsUpload }), gstBills.addDocuments);
  filingRouter.get('/:id/bill/documents/:docId', resolveTenantForFiling, can('gst_bills.view'), validate({ params: idParams.extend({ docId: objectIdSchema }) }), gstBills.getDocument);

  // ---- Vendor final document (Phase 21) — a SEPARATE document from the client's own bill upload above.
  // Viewing uses the SAME gst_bills.view gate already covering the client bill (CLIENT_ADMIN/MASTER_ADMIN/
  // GST_VENDOR can all see it); uploading uses the separate gst_bills.final_document.upload (GST_VENDOR +
  // MASTER_ADMIN only — never CLIENT_ADMIN/CLIENT_USER).
  filingRouter.post('/:id/final-document', resolveTenantForFiling, can('gst_bills.final_document.upload'), validate({ params: idParams, body: gstFinalDocumentUpload }), gstBills.addFinalDocument);
  filingRouter.get('/:id/final-documents', resolveTenantForFiling, can('gst_bills.view'), validate({ params: idParams }), gstBills.getFinalDocuments);
  filingRouter.get('/:id/final-documents/:docId', resolveTenantForFiling, can('gst_bills.view'), validate({ params: idParams.extend({ docId: objectIdSchema }) }), gstBills.getFinalDocument);

  // ---- GST Bill <-> Tally bill-by-bill matching (Phase 20). Same resolveTenantForFiling ownership chain;
  // viewing the result uses gst_bills.view (CLIENT_ADMIN/MASTER_ADMIN/GST_VENDOR), triggering a (re-)run
  // uses the separate, more sensitive gst_bills.match (GST_VENDOR + MASTER_ADMIN only — never CLIENT_ADMIN).
  filingRouter.get('/:id/tally-matching', resolveTenantForFiling, can('gst_bills.view'), validate({ params: idParams }), gstBillMatching.get);
  filingRouter.post('/:id/tally-matching/run', resolveTenantForFiling, can('gst_bills.match'), validate({ params: idParams }), gstBillMatching.run);

  r.use('/gst-filings', filingRouter);

  // ---- legacy GST filing placeholder (PLACEHOLDER — unrelated per-invoice gstFilingStatus field, untouched by Phase 8)
  r.get('/gst/filings', authenticate, can('gst.view'), notImplemented('GST filing list'));
  r.patch('/gst/filings/:id/status', authenticate, can('gst.update_status'), notImplemented('GST filing status update'));

  // ---- Tally integration (Phase 6)
  const tally = createTallyController(services);
  r.get('/tally/config', ...tenantScoped('tally.view'), tally.getConfig);
  r.post('/tally/config', ...tenantScoped('tally.configure'), validate({ body: tallyConfigBody }), tally.upsertConfig);
  r.post('/tally/test-connection', limiters.integration, ...tenantScoped('tally.configure'), tally.testConnection);
  r.post('/invoices/:id/tally-sync', limiters.integration, ...tenantScoped('tally.sync'), validate({ params: idParams }), tally.syncInvoice);
  r.get('/invoices/:id/tally-sync', ...invoiceScoped('tally.view'), validate({ params: idParams }), tally.syncStatus);

  // ---- Tally Public API key management (Phase 13; JWT-authenticated human admin managing keys for their
  // own tenant — NOT the API key authentication itself, see the /tally/public router below)
  const tallyApiKeys = createTallyApiKeyController(services);
  r.get('/tally/api-keys', ...tenantScoped('tally.api_keys.view'), tallyApiKeys.list);
  r.post('/tally/api-keys', ...tenantScoped('tally.api_keys.create'), validate({ body: tallyApiKeyCreateBody }), tallyApiKeys.create);
  r.get('/tally/api-keys/:id', ...tenantScoped('tally.api_keys.view'), validate({ params: idParams }), tallyApiKeys.get);
  r.post('/tally/api-keys/:id/revoke', ...tenantScoped('tally.api_keys.revoke'), validate({ params: idParams }), tallyApiKeys.revoke);
  r.post('/tally/api-keys/:id/rotate', ...tenantScoped('tally.api_keys.rotate'), validate({ params: idParams }), tallyApiKeys.rotate);

  // ---- Tally Public API (Phase 13; Tally/TDL -> ERP direction — the OPPOSITE of the ERP -> Tally routes
  // above). Authenticated by X-Tally-API-Key, never the ERP JWT. See docs/api/tally-public-api.md.
  const tallyPublic = createTallyPublicApiController(services);
  const tallyApiAuth = createTallyApiAuthMiddlewares({ tallyApiKeyService: services.tallyApiKeyService, auditService: services.auditService });
  const tallyScoped = (...scopes) => [limiters.tallyPublicApi, tallyApiAuth.authenticate, ...scopes.map((s) => tallyApiAuth.requireScope(s))];
  const publicRouter = Router();
  publicRouter.get('/company', ...tallyScoped('tally:company:read'), tallyPublic.company);
  publicRouter.get('/customers', ...tallyScoped('tally:customer:read'), validate({ query: listQuery }), tallyPublic.customers);
  publicRouter.get('/products', ...tallyScoped('tally:product:read'), validate({ query: listQuery }), tallyPublic.products);
  publicRouter.get('/invoices', ...tallyScoped('tally:invoice:read'), validate({ query: listQuery }), tallyPublic.invoices);
  publicRouter.get('/invoices/:id', ...tallyScoped('tally:invoice:read'), validate({ params: idParams }), tallyPublic.invoice);
  publicRouter.post('/invoices/:id/sync', ...tallyScoped('tally:sync'), validate({ params: idParams }), tallyPublic.sync);
  r.use('/tally/public', publicRouter);

  // ---- Phase 16: Tally Connector bridge — admin-facing credential management (JWT-authenticated human
  // Master Admin / Client Admin; mirrors the Tally Public API key management block above, but for a THIRD,
  // independent credential type — see docs/integrations/tally-connector.md).
  const tallyConnectors = createTallyConnectorController(services);
  r.get('/tally/connectors', ...tenantScoped('tally.connector.view'), tallyConnectors.list);
  r.post('/tally/connectors', ...tenantScoped('tally.connector.manage'), validate({ body: tallyConnectorRegisterBody }), tallyConnectors.register);
  r.get('/tally/connectors/:id', ...tenantScoped('tally.connector.view'), validate({ params: idParams }), tallyConnectors.get);
  r.post('/tally/connectors/:id/revoke', ...tenantScoped('tally.connector.manage'), validate({ params: idParams }), tallyConnectors.revoke);
  r.post('/tally/connectors/:id/rotate', ...tenantScoped('tally.connector.manage'), validate({ params: idParams }), tallyConnectors.rotate);

  // ---- Phase 16: Tally Connector bridge — connector-facing API (spec Step 7). Authenticated by the
  // dedicated connector secret (X-Tally-Connector-Secret header), NEVER the ERP JWT, the Tally Public API
  // key, or Master Admin auth. Tenant is always resolved FROM the authenticated connector (spec Step 8) —
  // nothing here ever trusts a tenantId from the request.
  const tallyConnectorApi = createTallyConnectorApiController(services);
  const tallyConnectorAuth = createTallyConnectorAuthMiddlewares({ tallyConnectorService: services.tallyConnectorService, auditService: services.auditService });
  const connectorScoped = (...scopes) => [limiters.tallyConnector, tallyConnectorAuth.authenticate, ...scopes.map((s) => tallyConnectorAuth.requireScope(s))];
  const connectorRouter = Router();
  connectorRouter.get('/status', ...connectorScoped('tally:connector:poll'), tallyConnectorApi.status);
  connectorRouter.post('/heartbeat', ...connectorScoped('tally:connector:heartbeat'), validate({ body: tallyConnectorHeartbeatBody }), tallyConnectorApi.heartbeat);
  connectorRouter.get('/jobs', ...connectorScoped('tally:connector:poll'), tallyConnectorApi.listJobs);
  connectorRouter.post('/jobs/:jobId/claim', ...connectorScoped('tally:connector:poll'), validate({ params: z.object({ jobId: objectIdSchema }) }), tallyConnectorApi.claim);
  connectorRouter.post('/jobs/:jobId/result', ...connectorScoped('tally:connector:submit'), validate({ params: z.object({ jobId: objectIdSchema }), body: tallyJobResultBody }), tallyConnectorApi.result);
  r.use('/tally/connector', connectorRouter);

  // ---- reports (Phase 9; tenant-scoped via resolveTenant — client roles get their own tenant, Master Admin needs X-Admin-Tenant-Id)
  r.get('/reports', authenticate, can('reports.view'), tenantReports.catalog);
  r.get('/reports/:type', authenticate, resolveTenant, validate({ params: reportTypeParams, query: reportQuery }), reportPerms(false), tenantReports.run);
  r.get('/reports/:type/export', authenticate, resolveTenant, validate({ params: reportTypeParams, query: reportQuery }), reportPerms(true), tenantReports.exportCsv);

  // ---- notifications (Phase 9; authentication only — every query is scoped to req.auth.userId, so there is no cross-user surface to permission-gate)
  const notifications = createNotificationController(services);
  r.get('/notifications', authenticate, validate({ query: notificationListQuery }), notifications.list);
  r.get('/notifications/unread-count', authenticate, notifications.unreadCount);
  r.patch('/notifications/read-all', authenticate, notifications.markAllRead);
  r.patch('/notifications/:id/read', authenticate, validate({ params: idParams }), notifications.markRead);

  // ---- Phase 15: client bill intake + Tally queue. bills.view/create/update/submit are tenant-scoped
  // (client uploads its own bills); review/reject are Master-Admin-only; the Tally-processing status
  // actions and the queue view are shared by Master Admin (platform-wide) and GST_VENDOR (assigned clients
  // only, via resolveTenantForBill's exact Phase 7 assignment-chain reuse).
  const bills = createBillIntakeController({ billIntakeService: services.billIntakeService });
  const billRouter = Router();
  billRouter.use(authenticate);
  billRouter.get('/', can('bills.view'), validate({ query: billListQuery }), bills.list);
  billRouter.post('/', resolveTenant, can('bills.create'), validate({ body: billCreate }), bills.create);
  billRouter.get('/:id', resolveTenantForBill, can('bills.view'), validate({ params: idParams }), bills.get);
  billRouter.patch('/:id', resolveTenantForBill, can('bills.update'), validate({ params: idParams, body: billUpdate }), bills.update);
  billRouter.post('/:id/documents', resolveTenantForBill, can('bills.documents.upload'), validate({ params: idParams, body: billDocumentsUpload }), bills.addDocuments);
  billRouter.get('/:id/documents/:docId', resolveTenantForBill, can('bills.documents.view'), validate({ params: idParams.extend({ docId: objectIdSchema }) }), bills.getDocument);
  billRouter.post('/:id/submit', resolveTenantForBill, can('bills.submit'), validate({ params: idParams }), bills.submit);
  billRouter.post('/:id/review', resolveTenantForBill, requireRole(ROLES.MASTER_ADMIN), can('bills.review'), validate({ params: idParams }), bills.review);
  billRouter.post('/:id/reject', resolveTenantForBill, requireRole(ROLES.MASTER_ADMIN), can('bills.reject'), validate({ params: idParams, body: billReject }), bills.reject);
  billRouter.post('/:id/tally/processing', resolveTenantForBill, can('bills.tally_manage'), validate({ params: idParams }), bills.tallyProcessingStarted);
  billRouter.post('/:id/tally/synced', resolveTenantForBill, can('bills.tally_manage'), validate({ params: idParams, body: billTallySynced }), bills.tallySynced);
  billRouter.post('/:id/tally/failed', resolveTenantForBill, can('bills.tally_manage'), validate({ params: idParams, body: billTallyFailed }), bills.tallyFailed);
  billRouter.post('/:id/tally/retry', resolveTenantForBill, can('bills.tally_manage'), validate({ params: idParams }), bills.tallyRetry);
  billRouter.post('/:id/complete', resolveTenantForBill, can('bills.tally_manage'), validate({ params: idParams }), bills.complete);
  r.use('/bills', billRouter);
  r.get('/tally/queue', authenticate, can('tally_queue.view'), validate({ query: tallyQueueQuery }), bills.queue);

  // ---- data requests (PLACEHOLDER)
  r.all('/data-requests', authenticate, can('dataRequests.view'), notImplemented('Data principal request workflows'));

  // ---- audit logs (Master Admin)
  const audit = createAuditController(services);
  r.get('/audit-logs', authenticate, requireRole(ROLES.MASTER_ADMIN), can('audit_logs.view'), validate({ query: auditQuery }), audit.list);

  return r;
}