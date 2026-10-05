/** Server-derived request context passed into services. Never built from client-supplied identity fields. */
export function makeContext(req) {
  return {
    tenantId: req.tenantId ?? null,
    actor: { id: req.auth?.userId ?? null, role: req.auth?.role ?? null, vendorId: req.auth?.vendorId ?? null },
    permissions: req.auth?.permissions ?? new Set(),
    adminContext: Boolean(req.adminContext),
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 300),
    requestId: req.id,
  };
}
