export const ROLES = Object.freeze({
  MASTER_ADMIN: 'MASTER_ADMIN',
  CLIENT_ADMIN: 'CLIENT_ADMIN',
  CLIENT_USER: 'CLIENT_USER',
  GST_VENDOR: 'GST_VENDOR',
});
export const ROLE_VALUES = Object.values(ROLES);
export const TENANT_ROLES = Object.freeze([ROLES.CLIENT_ADMIN, ROLES.CLIENT_USER]);
export const isTenantRole = (role) => TENANT_ROLES.includes(role);
