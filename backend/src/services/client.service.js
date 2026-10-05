import { ConflictError, NotFoundError } from '../utils/errors.js';
import { hashPassword } from '../security/password.js';
import { ROLES } from '../constants/roles.js';
import { TENANT_STATUS, USER_STATUS, AUDIT_ACTIONS } from '../constants/statuses.js';
import { ID_PREFIX } from '../constants/pagination.js';
import { formatCode } from '../utils/codes.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

export class ClientService {
  constructor({
    tenantRepo, userRepo, counterRepo, auditService, assignmentRepo, vendorRepo, notificationService = null,
  }) {
    Object.assign(this, {
      tenantRepo, userRepo, counterRepo, auditService, assignmentRepo, vendorRepo, notificationService,
    });
  }

  async create(ctx, dto) {
    const { admin, ...tenantData } = dto;
    if (admin && (await this.userRepo.findByEmail(admin.email))) throw new ConflictError('A user with this email already exists', 'EMAIL_IN_USE');
    const seq = await this.counterRepo.next(null, 'tenant');
    const tenant = await this.tenantRepo.create({
      ...tenantData, tenantCode: formatCode(ID_PREFIX.tenant, seq), status: TENANT_STATUS.ACTIVE, createdBy: ctx.actor.id,
    });

    let adminUser;
    if (admin) {
      try {
        adminUser = await this.userRepo.createUnscoped({
          tenantId: tenant._id,
          name: admin.name,
          email: admin.email,
          passwordHash: await hashPassword(admin.password),
          role: ROLES.CLIENT_ADMIN,
          // Created PENDING: Master Admin activates via PATCH /users/:id (status: ACTIVE) using the
          // X-Admin-Tenant-Id administrative access path. No email-sending / invite-token system exists yet.
          status: USER_STATUS.PENDING,
          tokenVersion: 0,
          failedLoginAttempts: 0,
          passwordChangedAt: new Date(),
          isEmailVerified: false,
        });
      } catch (err) {
        // Compensating rollback: the tenant must never be left behind without its requested admin.
        await this.tenantRepo.deleteHard?.(tenant._id);
        throw err;
      }
      await this.auditService.record(ctx, {
        action: AUDIT_ACTIONS.CLIENT_ADMIN_CREATED, resourceType: 'User', resourceId: adminUser._id, tenantId: tenant._id, metadata: { role: ROLES.CLIENT_ADMIN },
      });
    }
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TENANT_CREATED, resourceType: 'Tenant', resourceId: tenant._id, tenantId: tenant._id });
    return { tenant, adminUser: adminUser && { id: adminUser._id, email: adminUser.email, name: adminUser.name, status: adminUser.status } };
  }

  async list(query) {
    const p = parsePagination(query);
    const result = await this.tenantRepo.findPage({
      ...p,
      search: query.search,
      status: query.status,
      sort: parseSort(query.sort, ['businessName', 'tenantCode', 'createdAt', 'status']),
    });
    return { items: result.items, pagination: buildPageMeta(p, result.total) };
  }

  async get(id) {
    const tenant = await this.tenantRepo.findById(id);
    if (!tenant || tenant.isDeleted) throw new NotFoundError('Client not found');
    return tenant;
  }

  async update(ctx, id, patch) {
    await this.get(id);
    const updated = await this.tenantRepo.updateById(id, patch);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TENANT_UPDATED, resourceType: 'Tenant', resourceId: id, tenantId: id, metadata: { fields: Object.keys(patch) } });
    return updated;
  }

  async setStatus(ctx, id, status, reason) {
    const current = await this.get(id);
    const updated = await this.tenantRepo.updateById(id, { status });
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TENANT_STATUS_CHANGED, resourceType: 'Tenant', resourceId: id, tenantId: id, metadata: { previous: current.status, next: status, reason: reason ?? null },
    });
    if (updated && current.status !== status) await this.notificationService?.clientStatusChanged(updated, current.status, status);
    return updated;
  }

  async stats() {
    const entries = await Promise.all(Object.values(TENANT_STATUS).map(async (s) => [s, await this.tenantRepo.countByStatus(s)]));
    return { clientsByStatus: Object.fromEntries(entries) };
  }

  /** Per-client summary for the Client Details page: user counts by status, plus vendor assignment count. */
  async summary(id) {
    await this.get(id);
    const [users, vendorAssignments] = await Promise.all([
      this.userRepo.countsByStatusForTenant(id),
      this.assignmentRepo?.countActiveForTenant ? this.assignmentRepo.countActiveForTenant(id) : null,
    ]);
    return {
      users: {
        total: users.total,
        active: users.byStatus.ACTIVE ?? 0,
        inactive: users.byStatus.INACTIVE ?? 0,
        pending: users.byStatus.PENDING ?? 0,
        suspended: users.byStatus.SUSPENDED ?? 0,
      },
      activeVendorAssignments: vendorAssignments,
    };
  }

  /** Platform-wide aggregate counts for GET /master/dashboard. Mongo aggregation only, never in-memory loops over full collections. */
  async dashboard() {
    const [clientsByStatus, users, vendors, activeAssignments] = await Promise.all([
      this.stats(),
      this.userRepo.globalCounts(),
      this.vendorRepo?.countAll ? this.vendorRepo.countAll() : null,
      this.assignmentRepo?.countActive ? this.assignmentRepo.countActive() : null,
    ]);
    return {
      clients: {
        total: Object.values(clientsByStatus.clientsByStatus).reduce((s, n) => s + n, 0),
        active: clientsByStatus.clientsByStatus.ACTIVE ?? 0,
        pending: clientsByStatus.clientsByStatus.PENDING ?? 0,
        suspended: clientsByStatus.clientsByStatus.SUSPENDED ?? 0,
        inactive: clientsByStatus.clientsByStatus.INACTIVE ?? 0,
      },
      users: { total: users.total, active: users.active },
      gstVendors: vendors,
      activeVendorAssignments: activeAssignments,
    };
  }
}
