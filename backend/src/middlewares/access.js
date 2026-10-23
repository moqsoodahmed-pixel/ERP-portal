import { asyncHandler } from '../utils/asyncHandler.js';
import {
  AuthenticationError, AuthorizationError, NotFoundError, TenantAccessError, ValidationError,
} from '../utils/errors.js';
import { ROLES, isTenantRole } from '../constants/roles.js';
import { HEADERS } from '../constants/pagination.js';
import { AUDIT_ACTIONS, SECURITY_EVENT_TYPES } from '../constants/statuses.js';
import { isObjectId } from '../utils/objectId.js';
import { makeContext } from '../utils/context.js';

/** Authentication, authorization and tenant resolution. Identity is ALWAYS derived server-side. */
export function createAccessMiddlewares({
  authService, tenantRepo, assignmentRepo, invoiceRepo, securityService, auditService, gstFilingRepo, billRepo,
}) {
  const authenticate = asyncHandler(async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new AuthenticationError('Authentication required', 'AUTHENTICATION_REQUIRED');
    try {
      req.auth = await authService.authenticateAccessToken(token);
    } catch (err) {
      if (err.code === 'TOKEN_INVALID') await securityService.record(SECURITY_EVENT_TYPES.INVALID_TOKEN, makeContext(req), { severity: 'LOW' });
      throw err;
    }
    next();
  });

  const deny = async (req, details) => {
    const ctx = makeContext(req);
    await securityService.record(SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'LOW', userId: req.auth?.userId, details });
    await auditService.record(ctx, {
      action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS_ATTEMPT, resourceType: 'Route', metadata: { method: req.method, path: req.baseUrl + req.path, ...details },
    });
    throw new AuthorizationError();
  };

  /** A user tried to reach another tenant's data: security event + audit entry, then a deliberately uninformative 403. */
  const denyCrossTenant = async (req, details) => {
    const ctx = makeContext(req);
    await securityService.record(SECURITY_EVENT_TYPES.CROSS_TENANT_ACCESS, ctx, { severity: 'HIGH', userId: req.auth?.userId, tenantId: req.auth?.tenantId, details });
    await auditService.record(ctx, {
      action: AUDIT_ACTIONS.CROSS_TENANT_ACCESS_ATTEMPT, tenantId: req.auth?.tenantId ?? undefined, resourceType: 'Tenant', metadata: { method: req.method, path: req.baseUrl + req.path, ...details },
    });
    throw new TenantAccessError();
  };

  /** All listed permissions are required. */
  const requirePermission = (...perms) => asyncHandler(async (req, res, next) => {
    const missing = perms.filter((p) => !req.auth.permissions.has(p));
    if (missing.length) await deny(req, { missing });
    next();
  });

  const requireRole = (...roles) => asyncHandler(async (req, res, next) => {
    if (!roles.includes(req.auth.role)) await deny(req, { requiredRoles: roles });
    next();
  });

  /** Validates that an assistant admin can only access assigned companies. */
  const assertAssistantAssigned = async (req, tenantId) => {
    if (req.auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (req.auth.assignedTenantIds || []).map(String);
      if (!assigned.includes(String(tenantId))) {
        await denyCrossTenant(req, { attemptedTenant: String(tenantId).slice(0, 40), actor: 'MASTER_ASSISTANT_ADMIN', reason: 'TENANT_NOT_ASSIGNED' });
      }
    }
  };

  /** Resolves the tenant for tenant-scoped routes. Client-supplied tenant identifiers are never trusted. */
  const resolveTenant = asyncHandler(async (req, res, next) => {
    const { auth } = req;
    const supplied = req.body?.tenantId ?? req.query?.tenantId;
    if (auth.role === ROLES.MASTER_ADMIN || auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const header = req.get(HEADERS.ADMIN_TENANT);
      if (!header || !isObjectId(header)) throw new ValidationError(`${HEADERS.ADMIN_TENANT} header is required for tenant-scoped administrative access`);
      await assertAssistantAssigned(req, header);
      const tenant = await tenantRepo.findById(header);
      if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
      req.tenantId = String(tenant._id);
      req.adminContext = true;
      await auditService.record(makeContext(req), {
        action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESS, resourceType: 'Tenant', resourceId: req.tenantId, metadata: { method: req.method, path: req.baseUrl + req.path },
      });
    } else if (isTenantRole(auth.role)) {
      if (supplied !== undefined && String(supplied) !== auth.tenantId) {
        await denyCrossTenant(req, { attemptedTenant: String(supplied).slice(0, 40) });
      }
      req.tenantId = auth.tenantId;
    } else {
      throw new TenantAccessError('This route is not available for your account type');
    }
    if (req.body && typeof req.body === 'object') delete req.body.tenantId;
    if (req.query) delete req.query.tenantId;
    next();
  });

  /** Vendor access to a client: requires an ACTIVE VendorClientAssignment, checked on every request. */
  /** An ACTIVE assignment to a SUSPENDED/INACTIVE/PENDING tenant never grants access. */
  const assertTenantActive = async (req, tenantId) => {
    const tenant = await tenantRepo.findById(tenantId);
    if (!tenant || tenant.isDeleted || tenant.status !== 'ACTIVE') {
      await denyCrossTenant(req, { attemptedTenant: String(tenantId).slice(0, 40), actor: 'GST_VENDOR', reason: 'TENANT_NOT_ACTIVE' });
    }
  };

  const requireVendorAssignment = (param = 'tenantId') => asyncHandler(async (req, res, next) => {
    if (req.auth.role !== ROLES.GST_VENDOR) await deny(req, { requiredRoles: [ROLES.GST_VENDOR] });
    const tenantId = req.params[param];
    const assignment = isObjectId(tenantId) ? await assignmentRepo.findActive(req.auth.vendorId, tenantId) : null;
    if (!assignment) {
      await denyCrossTenant(req, { attemptedTenant: String(tenantId).slice(0, 40), actor: 'GST_VENDOR' });
    }
    await assertTenantActive(req, tenantId);
    req.tenantId = String(tenantId);
    await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.VENDOR_DATA_ACCESS, resourceType: 'Tenant', resourceId: tenantId, metadata: { path: req.baseUrl + req.path } });
    next();
  });

  /**
   * Tenant resolution for invoice-id routes (GET detail/pdf/tally-sync) that must also work for GST_VENDOR.
   * For a vendor, the invoice's tenantId is looked up first (never trusted from the URL/body), then the
   * full assignment chain is verified exactly as in requireVendorAssignment. For every other role the
   * existing resolveTenant behaviour is unchanged.
   */
  const resolveTenantForInvoice = asyncHandler(async (req, res, next) => {
    if (req.auth.role !== ROLES.GST_VENDOR) return resolveTenant(req, res, next);
    const invoiceId = req.params.id;
    const invoice = isObjectId(invoiceId) ? await invoiceRepo.findById(invoiceId) : null;
    if (!invoice) await denyCrossTenant(req, { attemptedInvoice: String(invoiceId).slice(0, 40), actor: 'GST_VENDOR' });
    const assignment = await assignmentRepo.findActive(req.auth.vendorId, invoice.tenantId);
    if (!assignment) await denyCrossTenant(req, { attemptedTenant: String(invoice.tenantId).slice(0, 40), actor: 'GST_VENDOR' });
    await assertTenantActive(req, invoice.tenantId);
    req.tenantId = String(invoice.tenantId);
    await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.VENDOR_DATA_ACCESS, resourceType: 'Invoice', resourceId: invoiceId, metadata: { path: req.baseUrl + req.path } });
    return next();
  });

  /**
   * Tenant resolution for GST filing :id routes. Reuses EXACTLY the Phase 7 assignment-chain pattern
   * (`resolveTenantForInvoice`): for a GST_VENDOR, the filing's own tenantId is looked up first (never
   * trusted from the URL/body), then the full ACTIVE-assignment + ACTIVE-tenant chain is verified. For
   * CLIENT_ADMIN/CLIENT_USER the filing's tenantId must match their own tenant (read-only — enforced by
   * permissions, not here). For MASTER_ADMIN the existing X-Admin-Tenant-Id resolveTenant behaviour is used,
   * and must additionally match the filing's actual tenant.
   */
  const resolveTenantForFiling = asyncHandler(async (req, res, next) => {
    const filingId = req.params.id;
    const filing = isObjectId(filingId) ? await gstFilingRepo.findById(filingId) : null;
    if (!filing) throw new NotFoundError('GST filing not found');
    if (req.auth.role === ROLES.GST_VENDOR) {
      const assignment = await assignmentRepo.findActive(req.auth.vendorId, filing.tenantId);
      if (!assignment) await denyCrossTenant(req, { attemptedTenant: String(filing.tenantId).slice(0, 40), actor: 'GST_VENDOR' });
      await assertTenantActive(req, filing.tenantId);
      req.tenantId = String(filing.tenantId);
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.VENDOR_DATA_ACCESS, resourceType: 'GSTFiling', resourceId: filingId, metadata: { path: req.baseUrl + req.path } });
      req.filing = filing;
      return next();
    }
    // Non-vendor roles: same tenant resolution as resolveTenant (admin header / own tenant), inlined here
    // (rather than composed) so the extra "does it match the filing's own tenant" check below is reliable.
    if (req.auth.role === ROLES.MASTER_ADMIN || req.auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const header = req.get(HEADERS.ADMIN_TENANT);
      if (!header || !isObjectId(header)) throw new ValidationError(`${HEADERS.ADMIN_TENANT} header is required for tenant-scoped administrative access`);
      await assertAssistantAssigned(req, header);
      await assertAssistantAssigned(req, filing.tenantId);
      const tenant = await tenantRepo.findById(header);
      if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
      req.tenantId = String(tenant._id);
      req.adminContext = true;
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESS, resourceType: 'Tenant', resourceId: req.tenantId, metadata: { method: req.method, path: req.baseUrl + req.path } });
    } else if (isTenantRole(req.auth.role)) {
      req.tenantId = req.auth.tenantId;
    } else {
      throw new TenantAccessError('This route is not available for your account type');
    }
    if (String(req.tenantId) !== String(filing.tenantId)) await denyCrossTenant(req, { attemptedTenant: String(filing.tenantId).slice(0, 40) });
    req.filing = filing;
    return next();
  });

  /**
   * Tenant resolution for POST /gst-filings (creation). There is no existing filing/invoice to derive the
   * tenant from yet, so the body's `tenantId` is the operator's declared target — but it is NEVER trusted on
   * its own: for MASTER_ADMIN the X-Admin-Tenant-Id header is authoritative and overwrites the body value;
   * for GST_VENDOR the body tenantId must correspond to an ACTIVE assignment (same chain as everywhere else);
   * for a tenant role (CLIENT_ADMIN/CLIENT_USER, Phase 19) the caller's own tenant is always used, exactly
   * like resolveTenant — any client-supplied tenantId is overwritten, never merely checked.
   */
  const resolveTenantForFilingCreate = asyncHandler(async (req, res, next) => {
    if (isTenantRole(req.auth.role)) {
      req.tenantId = req.auth.tenantId;
      req.body.tenantId = req.auth.tenantId;
    } else if (req.auth.role === ROLES.MASTER_ADMIN || req.auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const header = req.get(HEADERS.ADMIN_TENANT);
      if (!header || !isObjectId(header)) throw new ValidationError(`${HEADERS.ADMIN_TENANT} header is required for tenant-scoped administrative access`);
      await assertAssistantAssigned(req, header);
      const tenant = await tenantRepo.findById(header);
      if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
      req.tenantId = String(tenant._id);
      req.adminContext = true;
      req.body.tenantId = req.tenantId;
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESS, resourceType: 'Tenant', resourceId: req.tenantId, metadata: { method: req.method, path: req.baseUrl + req.path } });
    } else if (req.auth.role === ROLES.GST_VENDOR) {
      const tenantId = req.body?.tenantId;
      if (!isObjectId(tenantId)) throw new ValidationError('tenantId is required');
      const assignment = await assignmentRepo.findActive(req.auth.vendorId, tenantId);
      if (!assignment) await denyCrossTenant(req, { attemptedTenant: String(tenantId).slice(0, 40), actor: 'GST_VENDOR' });
      await assertTenantActive(req, tenantId);
      req.tenantId = String(tenantId);
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.VENDOR_DATA_ACCESS, resourceType: 'Tenant', resourceId: tenantId, metadata: { path: req.baseUrl + req.path } });
    } else {
      throw new TenantAccessError('This route is not available for your account type');
    }
    next();
  });

  /**
   * Phase 15 — tenant resolution for /bills/:id and /bills/:id/* routes. Reuses EXACTLY the Phase 7/8
   * assignment-chain pattern (`resolveTenantForFiling`): for GST_VENDOR, the bill's own tenantId is looked
   * up first (never trusted from the URL/body), then the full ACTIVE-assignment + ACTIVE-tenant chain is
   * verified. For CLIENT_ADMIN/CLIENT_USER the bill's tenantId must match their own tenant. For MASTER_ADMIN
   * the existing X-Admin-Tenant-Id resolveTenant behaviour is used, and must additionally match the bill's
   * actual tenant.
   */
  const resolveTenantForBill = asyncHandler(async (req, res, next) => {
    const billId = req.params.id;
    const bill = isObjectId(billId) ? await billRepo.findById(billId) : null;
    if (!bill) throw new NotFoundError('Bill not found');
    if (req.auth.role === ROLES.GST_VENDOR) {
      const assignment = await assignmentRepo.findActive(req.auth.vendorId, bill.tenantId);
      if (!assignment) await denyCrossTenant(req, { attemptedTenant: String(bill.tenantId).slice(0, 40), actor: 'GST_VENDOR' });
      await assertTenantActive(req, bill.tenantId);
      req.tenantId = String(bill.tenantId);
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.VENDOR_DATA_ACCESS, resourceType: 'BillIntake', resourceId: billId, metadata: { path: req.baseUrl + req.path } });
      req.bill = bill;
      return next();
    }
    if (req.auth.role === ROLES.MASTER_ADMIN || req.auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const header = req.get(HEADERS.ADMIN_TENANT);
      if (!header || !isObjectId(header)) throw new ValidationError(`${HEADERS.ADMIN_TENANT} header is required for tenant-scoped administrative access`);
      await assertAssistantAssigned(req, header);
      await assertAssistantAssigned(req, bill.tenantId);
      const tenant = await tenantRepo.findById(header);
      if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
      req.tenantId = String(tenant._id);
      req.adminContext = true;
      await auditService.record(makeContext(req), { action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESS, resourceType: 'Tenant', resourceId: req.tenantId, metadata: { method: req.method, path: req.baseUrl + req.path } });
    } else if (isTenantRole(req.auth.role)) {
      req.tenantId = req.auth.tenantId;
    } else {
      throw new TenantAccessError('This route is not available for your account type');
    }
    if (String(req.tenantId) !== String(bill.tenantId)) await denyCrossTenant(req, { attemptedTenant: String(bill.tenantId).slice(0, 40) });
    req.bill = bill;
    return next();
  });

  return {
    authenticate, requirePermission, requireRole, resolveTenant, requireVendorAssignment, resolveTenantForInvoice,
    resolveTenantForFiling, resolveTenantForFilingCreate, resolveTenantForBill,
  };
}