import { ConflictError, NotFoundError, ForbiddenError } from '../utils/errors.js';
import { hashPassword } from '../security/password.js';
import { ROLES } from '../constants/roles.js';
import { AUDIT_ACTIONS, USER_STATUS, ASSIGNMENT_STATUS } from '../constants/statuses.js';
import { ID_PREFIX } from '../constants/pagination.js';
import { formatCode } from '../utils/codes.js';
import { parsePagination, buildPageMeta } from '../utils/pagination.js';

export class VendorService {
  constructor({ vendorRepo, userRepo, tenantRepo, assignmentRepo, invoiceService, counterRepo, auditService, notificationService = null }) {
    Object.assign(this, { vendorRepo, userRepo, tenantRepo, assignmentRepo, invoiceService, counterRepo, auditService, notificationService });
  }

  /** Phase 9: VENDOR_ASSIGNMENT_CHANGED to the vendor's users, after the change is persisted. */
  async #notifyAssignment(assignment, action) {
    if (!this.notificationService || !assignment) return;
    const [vendor, tenant] = await Promise.all([this.vendorRepo.findById(assignment.vendorId), this.tenantRepo.findById(assignment.tenantId)]);
    await this.notificationService.vendorAssignmentChanged(assignment, action, { vendorName: vendor?.name, tenantName: tenant?.businessName });
  }

  async create(ctx, dto) {
    if (await this.userRepo.findByEmail(dto.user.email)) throw new ConflictError('A user with this email already exists', 'EMAIL_IN_USE');
    const vendorCode = formatCode(ID_PREFIX.vendor, await this.counterRepo.next(null, 'vendor'));
    const vendor = await this.vendorRepo.create({ vendorCode, name: dto.name, contactEmail: dto.contactEmail, phone: dto.phone, status: 'ACTIVE', createdBy: ctx.actor.id });
    const user = await this.userRepo.createUnscoped({
      vendorId: vendor._id, name: dto.user.name, email: dto.user.email, passwordHash: await hashPassword(dto.user.password),
      role: ROLES.GST_VENDOR, status: USER_STATUS.ACTIVE, tokenVersion: 0, failedLoginAttempts: 0, passwordChangedAt: new Date(), isEmailVerified: false,
    });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_CREATED, resourceType: 'Vendor', resourceId: vendor._id });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.USER_CREATED, resourceType: 'User', resourceId: user._id, metadata: { role: ROLES.GST_VENDOR } });
    return { vendor, user: { id: user._id, email: user.email, name: user.name } };
  }

  async list(query) {
    const p = parsePagination(query);
    const r = await this.vendorRepo.findPage({ ...p, search: query.search });
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async get(vendorId, ctx) {
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor || vendor.isDeleted) throw new NotFoundError('Vendor not found');
    let assignments = await this.assignmentRepo.listForVendor(vendorId);
    if (ctx?.actor?.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (ctx.actor.assignedTenantIds || []).map(String);
      assignments = assignments.filter((a) => assigned.includes(String(a.tenantId)));
    }
    return { vendor, assignments };
  }

  async update(ctx, vendorId, patch) {
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor || vendor.isDeleted) throw new NotFoundError('Vendor not found');
    const { userStatus, ...vendorPatch } = patch;
    const updated = Object.keys(vendorPatch).length ? await this.vendorRepo.updateById(vendorId, vendorPatch) : vendor;
    if (userStatus) {
      const user = await this.userRepo.model.findOne({ vendorId: String(vendorId), isDeleted: { $ne: true } }).lean();
      if (user) await this.userRepo.updateUnscoped(user._id, { $set: { status: userStatus } });
    }
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_UPDATED, resourceType: 'Vendor', resourceId: vendorId, metadata: { fields: Object.keys(patch) } });
    return updated;
  }

  async listAssignments(vendorId, ctx) {
    const assignments = await this.assignmentRepo.listForVendor(vendorId);
    if (ctx?.actor?.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (ctx.actor.assignedTenantIds || []).map(String);
      return assignments.filter((a) => assigned.includes(String(a.tenantId)));
    }
    return assignments;
  }

  /** Deactivate (reason required) or reactivate a specific assignment, scoped to this vendor only (IDOR guard). */
  async setAssignmentLifecycle(ctx, vendorId, assignmentId, { action, reason }) {
    const assignment = await this.assignmentRepo.byId(assignmentId);
    if (!assignment || String(assignment.vendorId) !== String(vendorId)) throw new NotFoundError('Assignment not found');
    if (ctx?.actor?.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (ctx.actor.assignedTenantIds || []).map(String);
      if (!assigned.includes(String(assignment.tenantId))) throw new ForbiddenError('Access denied to unassigned company');
    }
    if (action === 'deactivate') {
      if (assignment.status !== ASSIGNMENT_STATUS.ACTIVE) throw new ConflictError('Assignment is not active', 'NOT_ACTIVE');
      const updated = await this.assignmentRepo.unassign(vendorId, assignment.tenantId, ctx.actor.id, reason);
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_UNASSIGNED, resourceType: 'Vendor', resourceId: vendorId, tenantId: assignment.tenantId, metadata: { vendorId, assignmentId, reason } });
      await this.#notifyAssignment(updated, 'UNASSIGNED');
      return updated;
    }
    if (assignment.status !== ASSIGNMENT_STATUS.INACTIVE) throw new ConflictError('Assignment is not inactive', 'NOT_INACTIVE');
    if (await this.assignmentRepo.findActive(vendorId, assignment.tenantId)) throw new ConflictError('Vendor is already assigned to this client', 'ALREADY_ASSIGNED');
    const updated = await this.assignmentRepo.reactivateLatest(vendorId, assignment.tenantId, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_ASSIGNMENT_REACTIVATED, resourceType: 'Vendor', resourceId: vendorId, tenantId: assignment.tenantId, metadata: { vendorId, assignmentId } });
    await this.#notifyAssignment(updated, 'REACTIVATED');
    return updated;
  }

  /** Client Admin's view: LauncherDesk is the direct service provider. Client never sees third-party vendors. */
  async clientVendors(ctx) {
    if (ctx?.actor?.role === ROLES.CLIENT_ADMIN || ctx?.actor?.role === ROLES.CLIENT_USER) {
      return [];
    }
    const assignments = await this.assignmentRepo.listForTenant(ctx.tenantId);
    const vendors = await Promise.all(assignments.map(async (a) => {
      const vendor = await this.vendorRepo.findById(a.vendorId);
      return {
        assignmentId: a._id, status: a.status, assignedAt: a.assignedAt, deactivatedAt: a.unassignedAt ?? null,
        vendor: vendor ? { id: vendor._id, name: vendor.name, contactEmail: vendor.contactEmail } : null,
      };
    }));
    return vendors;
  }

  async assign(ctx, vendorId, tenantId) {
    if (ctx?.actor?.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (ctx.actor.assignedTenantIds || []).map(String);
      if (!assigned.includes(String(tenantId))) throw new ForbiddenError('Access denied to unassigned company');
    }
    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor || vendor.isDeleted) throw new NotFoundError('Vendor not found');
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
    if (await this.assignmentRepo.findActive(vendorId, tenantId)) throw new ConflictError('Vendor is already assigned to this client', 'ALREADY_ASSIGNED');
    const assignment = await this.assignmentRepo.create({ vendorId, tenantId, assignedBy: ctx.actor.id, status: ASSIGNMENT_STATUS.ACTIVE, assignedAt: new Date() });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_ASSIGNED, resourceType: 'Vendor', resourceId: vendorId, tenantId, metadata: { vendorId } });
    await this.#notifyAssignment(assignment, 'ASSIGNED');
    return assignment;
  }

  async unassign(ctx, vendorId, tenantId) {
    if (ctx?.actor?.role === ROLES.MASTER_ASSISTANT_ADMIN) {
      const assigned = (ctx.actor.assignedTenantIds || []).map(String);
      if (!assigned.includes(String(tenantId))) throw new ForbiddenError('Access denied to unassigned company');
    }
    const assignment = await this.assignmentRepo.unassign(vendorId, tenantId, ctx.actor.id);
    if (!assignment) throw new NotFoundError('Active assignment not found');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.VENDOR_UNASSIGNED, resourceType: 'Vendor', resourceId: vendorId, tenantId, metadata: { vendorId } });
    await this.#notifyAssignment(assignment, 'UNASSIGNED');
    return assignment;
  }

  /** Vendor's own client list: derived strictly from the authenticated vendor's active assignments. */
  async myClients(ctx) {
    const assignments = await this.assignmentRepo.listActiveByVendor(ctx.actor.vendorId);
    const tenants = await Promise.all(assignments.map((a) => this.tenantRepo.findById(a.tenantId)));
    return tenants.filter(Boolean).map((t) => ({ id: t._id, tenantCode: t.tenantCode, businessName: t.businessName, status: t.status }));
  }

  /** ctx.tenantId was set by requireVendorAssignment after verifying an ACTIVE assignment. */
  assignedClientInvoices(ctx, query) { return this.invoiceService.list(ctx, query); }
}