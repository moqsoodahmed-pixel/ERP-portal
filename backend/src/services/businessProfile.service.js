import crypto from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_FILE_BYTES } from '../validators/resource.validators.js';

/** Fields whose change is always worth a dedicated audit trail (legal/identity data). */
const SENSITIVE_FIELDS = ['displayName', 'gstin', 'address'];

export class BusinessProfileService {
  constructor({
    businessProfileRepo, fileMetadataRepo, storageService, auditService,
  }) {
    Object.assign(this, {
      businessProfileRepo, fileMetadataRepo, storageService, auditService,
    });
  }

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

  // ---------------------------------------------------------------- logo (reuses Phase 5 FileMetadata + StorageService; no public URL — always streamed through getLogo, authenticated + tenant-scoped)
  async uploadLogo(ctx, file) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimeType)) throw new ValidationError('Unsupported logo image type');
    const buffer = Buffer.from(file.contentBase64, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_LOGO_FILE_BYTES) throw new ValidationError('Logo must be between 1 byte and 2MB');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    // Unguessable, server-derived key (tenant + random id) — never built from the client-supplied fileName.
    const storageKey = `tenant/${ctx.tenantId}/business-profile/logo-${crypto.randomUUID()}`;
    await this.storageService.save(storageKey, buffer);
    let created;
    try {
      created = await this.fileMetadataRepo.createForTenant(ctx.tenantId, {
        uploadedBy: ctx.actor.id, fileName: String(file.fileName).slice(0, 255), mimeType: file.mimeType, size: buffer.length,
        storageProvider: 'LOCAL_DEV', storageKey, checksum, purpose: 'LOGO',
      });
    } catch (err) {
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
    const previousLogoFileId = profile.logoFileId;
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, profile._id, { logoFileId: String(created._id) }, ctx.actor.id);
    if (previousLogoFileId) await this.#deleteLogoFile(ctx.tenantId, previousLogoFileId);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: ['logoFileId'] } });
    return updated;
  }

  async removeLogo(ctx) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    if (!profile.logoFileId) return profile;
    await this.#deleteLogoFile(ctx.tenantId, profile.logoFileId);
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, profile._id, { logoFileId: null }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: ['logoFileId'] } });
    return updated;
  }

  async getLogo(ctx) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile?.logoFileId) throw new NotFoundError('No logo uploaded');
    const meta = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, profile.logoFileId);
    if (!meta) throw new NotFoundError('No logo uploaded');
    const buffer = await this.storageService.read(meta.storageKey);
    return { buffer, mimeType: meta.mimeType, fileName: meta.fileName };
  }

  async #deleteLogoFile(tenantId, fileId) {
    const meta = await this.fileMetadataRepo.findOneForTenant(tenantId, fileId);
    if (!meta) return;
    await this.storageService.delete(meta.storageKey).catch(() => {});
    await this.fileMetadataRepo.deleteForTenant(tenantId, fileId);
  }
}
