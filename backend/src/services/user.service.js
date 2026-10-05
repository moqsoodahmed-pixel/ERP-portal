import {
  AuthorizationError, ConflictError, NotFoundError, ValidationError,
} from '../utils/errors.js';
import { hashPassword } from '../security/password.js';
import { ROLES } from '../constants/roles.js';
import { USER_STATUS, AUDIT_ACTIONS } from '../constants/statuses.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

export class UserService {
  constructor({ userRepo, refreshRepo, auditService }) { Object.assign(this, { userRepo, refreshRepo, auditService }); }

  async list(ctx, query) {
    const p = parsePagination(query);
    const result = await this.userRepo.findPage(ctx.tenantId, {
      ...p, search: query.search, filter: query.status ? { status: query.status } : {}, sort: parseSort(query.sort, ['name', 'email', 'createdAt']),
    });
    return { items: result.items, pagination: buildPageMeta(p, result.total) };
  }

  /** Least privilege: a user can never grant permissions they do not hold themselves. */
  #assertCanGrant(ctx, permissions = []) {
    if (permissions.some((p) => !ctx.permissions.has(p))) throw new AuthorizationError('You cannot grant permissions you do not hold');
  }

  async create(ctx, dto) {
    // Only a Master Admin acting in an explicit tenant context may mint another CLIENT_ADMIN.
    if (dto.role === ROLES.CLIENT_ADMIN && ctx.actor.role !== ROLES.MASTER_ADMIN) throw new AuthorizationError('Only a platform administrator can create client administrators');
    this.#assertCanGrant(ctx, dto.grantedPermissions);
    if (await this.userRepo.findByEmail(dto.email)) throw new ConflictError('A user with this email already exists', 'EMAIL_IN_USE');
    const user = await this.userRepo.create(ctx.tenantId, {
      name: dto.name, email: dto.email, phone: dto.phone, role: dto.role, passwordHash: await hashPassword(dto.password),
      grantedPermissions: dto.role === ROLES.CLIENT_USER ? dto.grantedPermissions ?? [] : [], status: USER_STATUS.ACTIVE,
      isEmailVerified: false, passwordChangedAt: new Date(), tokenVersion: 0, failedLoginAttempts: 0,
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.USER_CREATED, resourceType: 'User', resourceId: user._id, metadata: { role: user.role } });
    return user;
  }

  /** Tenant-scoped: a user of another tenant simply does not exist for the caller (404). */
  async update(ctx, id, patch) {
    const target = await this.userRepo.findOneById(ctx.tenantId, id);
    if (!target) throw new NotFoundError('User not found');
    const isSelf = String(target._id) === ctx.actor.id;
    if (target.role === ROLES.CLIENT_ADMIN && !isSelf && ctx.actor.role !== ROLES.MASTER_ADMIN) {
      throw new AuthorizationError('Only a platform administrator can modify client administrators');
    }
    if (isSelf && patch.status && patch.status !== USER_STATUS.ACTIVE) throw new ConflictError('You cannot deactivate your own account', 'CANNOT_DISABLE_SELF');
    if (patch.grantedPermissions) {
      if (target.role !== ROLES.CLIENT_USER) throw new ValidationError('Extra permissions can only be granted to client users');
      this.#assertCanGrant(ctx, patch.grantedPermissions);
    }

    const updated = await this.userRepo.updateById(ctx.tenantId, id, patch, ctx.actor.id);
    const disabling = patch.status && patch.status !== USER_STATUS.ACTIVE && target.status === USER_STATUS.ACTIVE;
    if (disabling) {
      // Kill access tokens (tokenVersion) and every refresh token immediately.
      await this.userRepo.updateUnscoped(id, { $inc: { tokenVersion: 1 } });
      await this.refreshRepo.revokeAllForUser(id);
    }
    const isClientAdmin = target.role === ROLES.CLIENT_ADMIN;
    const action = disabling
      ? AUDIT_ACTIONS.USER_DISABLED
      : (isClientAdmin ? AUDIT_ACTIONS.CLIENT_ADMIN_UPDATED : AUDIT_ACTIONS.USER_UPDATED);
    await this.auditService.record(ctx, {
      action, resourceType: 'User', resourceId: id,
      metadata: disabling ? { previous: target.status, next: patch.status } : { fields: Object.keys(patch) },
    });
    return updated;
  }
}