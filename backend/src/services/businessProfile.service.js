import { ConflictError, NotFoundError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';

/** Fields whose change is always worth a dedicated audit trail (legal/identity data). */
const SENSITIVE_FIELDS = ['displayName', 'gstin', 'address'];

export class BusinessProfileService {
  constructor({ businessProfileRepo, auditService }) { Object.assign(this, { businessProfileRepo, auditService }); }

  async get(ctx) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    return profile;
  }

  async create(ctx, dto) {
    const existing = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (existing) throw new ConflictError('Business profile already exists for this client', 'BUSINESS_PROFILE_EXISTS');
    const profile = await this.businessProfileRepo.create(ctx.tenantId, dto, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_CREATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: Object.keys(dto) } });
    return profile;
  }

  async update(ctx, patch) {
    const existing = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!existing) throw new NotFoundError('Business profile has not been set up yet');
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, existing._id, patch, ctx.actor.id);
    const changedSensitive = Object.keys(patch).filter((f) => SENSITIVE_FIELDS.includes(f));
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED,
      resourceType: 'BusinessProfile',
      resourceId: existing._id,
      metadata: { fields: Object.keys(patch), sensitiveFieldsChanged: changedSensitive },
    });
    return updated;
  }
}
