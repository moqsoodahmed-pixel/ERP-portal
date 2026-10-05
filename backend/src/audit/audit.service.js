import { redactSecrets } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';

export class AuditService {
  constructor({ auditRepo }) { this.auditRepo = auditRepo; }

  /**
   * Appends an audit entry. A failure to write is logged but does not break the business request
   * (documented trade-off; high-assurance actions can opt into `{ strict: true }`).
   */
  async record(ctx, { action, resourceType, resourceId, metadata, tenantId, actorId, actorRole, strict = false }) {
    const entry = {
      actorId: actorId ?? ctx?.actor?.id ?? undefined,
      actorRole: actorRole ?? ctx?.actor?.role ?? undefined,
      tenantId: tenantId ?? ctx?.tenantId ?? null,
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : undefined,
      timestamp: new Date(),
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: redactSecrets(metadata),
    };
    try {
      await this.auditRepo.append(entry);
    } catch (err) {
      logger.error({ event: 'audit.write_failed', action, requestId: ctx?.requestId, err: err.message }, 'Audit write failed');
      if (strict) throw err;
    }
  }

  list(query) { return this.auditRepo.findPage(query); }
}
