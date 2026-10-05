/** UI-only convenience. The backend is the single source of truth and re-checks every request. */
export const can = (user, permission) => Boolean(user?.permissions?.includes(permission));
export const canAny = (user, permissions = []) => permissions.length === 0 || permissions.some((p) => can(user, p));
