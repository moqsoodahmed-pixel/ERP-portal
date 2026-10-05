import { redactSecrets } from '../utils/sanitize.js';
import { logger } from '../utils/logger.js';

export class SecurityEventService {
  constructor({ securityRepo }) { this.securityRepo = securityRepo; }

  async record(type, ctx = {}, { severity = 'MEDIUM', userId, tenantId, details, isPotentialPersonalDataBreach = false } = {}) {
    logger.warn({ event: `security.${type}`, requestId: ctx.requestId, userId, tenantId }, 'Security event');
    try {
      await this.securityRepo.create({
        type, severity, userId, tenantId: tenantId ?? ctx.tenantId ?? null, ipAddress: ctx.ip, userAgent: ctx.userAgent,
        requestId: ctx.requestId, details: redactSecrets(details), isPotentialPersonalDataBreach,
      });
    } catch (err) {
      logger.error({ event: 'security.write_failed', type, err: err.message }, 'Security event write failed');
    }
  }
}
