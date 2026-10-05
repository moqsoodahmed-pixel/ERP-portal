import { ALL_PERMISSIONS, GRANTABLE_TO_TENANT_USERS, ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions.js';
import { ROLES } from '../constants/roles.js';

/** Effective permissions = role defaults + (tenant roles only) direct grants + custom roles, limited to grantable permissions. */
export class PermissionService {
  constructor({ roleRepo, userRoleRepo }) { this.roleRepo = roleRepo; this.userRoleRepo = userRoleRepo; }

  async resolve(user) {
    const set = new Set(ROLE_DEFAULT_PERMISSIONS[user.role] ?? []);
    const canExtend = user.role === ROLES.CLIENT_ADMIN || user.role === ROLES.CLIENT_USER;
    if (!canExtend) return set;
    const allowed = (p) => ALL_PERMISSIONS.includes(p) && GRANTABLE_TO_TENANT_USERS.includes(p);
    (user.grantedPermissions ?? []).filter(allowed).forEach((p) => set.add(p));
    const links = await this.userRoleRepo.findByUserId(user._id);
    if (links.length) {
      const roles = await this.roleRepo.findByIds(links.map((l) => l.roleId), user.tenantId);
      roles.flatMap((r) => r.permissions ?? []).filter(allowed).forEach((p) => set.add(p));
    }
    return set;
  }
}
