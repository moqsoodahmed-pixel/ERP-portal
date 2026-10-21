import crypto from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';
import { ALLOWED_LOGO_MIME_TYPES, MAX_LOGO_FILE_BYTES, MAX_LETTERHEAD_ASSET_FILE_BYTES } from '../validators/resource.validators.js';

/** Fields whose change is always worth a dedicated audit trail (legal/identity data). */
const SENSITIVE_FIELDS = ['displayName', 'gstin', 'address'];

/**
 * Phase 22 — every letterhead asset (logo, background, watermark, signature, seal, QR code) shares the
 * exact same storage shape: one `xFileId` field on BusinessProfile, uploaded/removed/read through
 * FileMetadata + StorageService (never inline/base64 in Mongo). This table drives the generic
 * #uploadAsset/#removeAsset/#getAsset below so each asset type isn't a hand-copied near-duplicate.
 */
const ASSET_TYPES = {
  LOGO: { field: 'logoFileId', purpose: 'LOGO', maxBytes: MAX_LOGO_FILE_BYTES },
  BACKGROUND: { field: 'letterheadBackgroundFileId', purpose: 'LETTERHEAD_BACKGROUND', maxBytes: MAX_LETTERHEAD_ASSET_FILE_BYTES },
  WATERMARK: { field: 'watermarkFileId', purpose: 'LETTERHEAD_WATERMARK', maxBytes: MAX_LETTERHEAD_ASSET_FILE_BYTES },
  SIGNATURE: { field: 'signatureFileId', purpose: 'LETTERHEAD_SIGNATURE', maxBytes: MAX_LOGO_FILE_BYTES },
  SEAL: { field: 'sealFileId', purpose: 'LETTERHEAD_SEAL', maxBytes: MAX_LOGO_FILE_BYTES },
  QR_CODE: { field: 'qrCodeFileId', purpose: 'LETTERHEAD_QR_CODE', maxBytes: MAX_LOGO_FILE_BYTES },
};

export class BusinessProfileService {
  constructor({
    businessProfileRepo, fileMetadataRepo, storageService, auditService, pdfService = null,
  }) {
    Object.assign(this, {
      businessProfileRepo, fileMetadataRepo, storageService, auditService, pdfService,
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

  /**
   * Phase 22 — restores the default (blank) letterhead: unlinks every asset field and clears every
   * letterhead text/bank field. Never touches displayName/gstin/address/etc — "reset layout", not "delete
   * business profile". Deliberately does NOT delete the underlying FileMetadata/storage bytes for any
   * asset that was in use — see the doc comment on #uploadAsset below for why.
   */
  async resetLetterhead(ctx) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    const clearPatch = {
      ...Object.fromEntries(Object.values(ASSET_TYPES).map(({ field }) => [field, null])),
      bankDetails: null, footerText: null, defaultTermsAndConditions: null, declaration: null,
      authorizedSignatoryName: null, authorizedSignatoryDesignation: null,
    };
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, profile._id, clearPatch, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: ['letterheadReset'] } });
    return updated;
  }

  /**
   * Phase 22 — "Live A4 / PDF / Print Preview": renders a SAMPLE invoice (fake customer + one line item,
   * never real tenant data) using the CURRENT letterhead (live BusinessProfile, not any frozen invoice
   * snapshot), so an admin can see the effect of an edit before it's ever applied to a real invoice.
   */
  async previewLetterheadPdf(ctx) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    const fetchAsset = async (fileId) => {
      if (!fileId) return null;
      try {
        const meta = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, fileId);
        if (!meta) return null;
        return { buffer: await this.storageService.read(meta.storageKey), mimeType: meta.mimeType };
      } catch { return null; }
    };
    const [logo, background, watermark, signature, seal, qrCode] = await Promise.all([
      fetchAsset(profile.logoFileId), fetchAsset(profile.letterheadBackgroundFileId), fetchAsset(profile.watermarkFileId),
      fetchAsset(profile.signatureFileId), fetchAsset(profile.sealFileId), fetchAsset(profile.qrCodeFileId),
    ]);
    const letterhead = {
      logo, background, watermark, signature, seal, qrCode, bankDetails: profile.bankDetails, footerText: profile.footerText,
      declaration: profile.declaration, authorizedSignatoryName: profile.authorizedSignatoryName, authorizedSignatoryDesignation: profile.authorizedSignatoryDesignation,
    };
    const sampleInvoice = {
      invoiceNumber: 'SAMPLE-000001', invoiceDate: new Date(), dueDate: new Date(), invoiceStatus: 'DRAFT',
      supplierSnapshot: { businessName: profile.displayName, gstin: profile.gstin, address: profile.address, stateCode: profile.address?.stateCode, email: profile.email, mobile: profile.mobile },
      customerSnapshot: { name: 'Sample Customer', gstin: '27AAAPL1234C1Z5', pan: 'AAAPL1234C', stateCode: '27' },
      items: [{
        lineNo: 1, productName: 'Sample Product', hsnSacCode: '0000', quantity: '1', unitPrice: '1000.00',
        taxableAmount: '1000.00', gstRate: 18, cgst: '90.00', sgst: '90.00', igst: '0.00', lineTotal: '1180.00',
      }],
      subtotal: '1000.00', discount: '0.00', taxableAmount: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00',
      totalTax: '180.00', roundOff: '0.00', grandTotal: '1180.00', termsAndConditions: profile.defaultTermsAndConditions,
      notes: 'This is a sample invoice for letterhead preview purposes only.',
    };
    return this.pdfService.generate(sampleInvoice, letterhead);
  }

  // ---------------------------------------------------------------- generic letterhead asset storage
  // (reuses Phase 5 FileMetadata + StorageService; no public URL — always streamed through an
  // authenticated, tenant-scoped GET endpoint, same pattern as the original logo-only implementation)
  //
  // IMPORTANT: replacing or removing an asset here never deletes the PREVIOUS FileMetadata row/storage
  // bytes. Every invoice/credit-note/debit-note freezes a `letterheadSnapshot` of the asset ids active at
  // creation time (same "never let a later edit retroactively change history" rule as customerSnapshot/
  // supplierSnapshot) — hard-deleting an old asset the moment it's replaced would silently blank out the
  // letterhead on every already-issued document that still points at it. Orphaned rows/bytes for assets no
  // historical document references anymore are an acceptable, small storage cost for that guarantee; a
  // dedicated admin "purge unreferenced letterhead assets" job would be the right place to reclaim them,
  // not this request-path code.
  async #uploadAsset(ctx, assetType, file) {
    const { field, purpose, maxBytes } = ASSET_TYPES[assetType];
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimeType)) throw new ValidationError('Unsupported image type');
    const buffer = Buffer.from(file.contentBase64, 'base64');
    if (buffer.length === 0 || buffer.length > maxBytes) throw new ValidationError(`Image must be between 1 byte and ${Math.round(maxBytes / (1024 * 1024))}MB`);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    // Unguessable, server-derived key (tenant + random id) — never built from the client-supplied fileName.
    const storageKey = `tenant/${ctx.tenantId}/business-profile/${field}-${crypto.randomUUID()}`;
    await this.storageService.save(storageKey, buffer);
    let created;
    try {
      created = await this.fileMetadataRepo.createForTenant(ctx.tenantId, {
        uploadedBy: ctx.actor.id, fileName: String(file.fileName).slice(0, 255), mimeType: file.mimeType, size: buffer.length,
        storageProvider: 'LOCAL_DEV', storageKey, checksum, purpose,
      });
    } catch (err) {
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, profile._id, { [field]: String(created._id) }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: [field] } });
    return updated;
  }

  /** Unlinks the asset from the profile; the underlying FileMetadata/storage bytes are kept (see #uploadAsset doc comment). */
  async #removeAsset(ctx, assetType) {
    const { field } = ASSET_TYPES[assetType];
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new NotFoundError('Business profile has not been set up yet');
    if (!profile[field]) return profile;
    const updated = await this.businessProfileRepo.updateById(ctx.tenantId, profile._id, { [field]: null }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.BUSINESS_PROFILE_UPDATED, resourceType: 'BusinessProfile', resourceId: profile._id, metadata: { fields: [field] } });
    return updated;
  }

  async #getAsset(ctx, assetType) {
    const { field } = ASSET_TYPES[assetType];
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile?.[field]) throw new NotFoundError('No image uploaded');
    const meta = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, profile[field]);
    if (!meta) throw new NotFoundError('No image uploaded');
    const buffer = await this.storageService.read(meta.storageKey);
    return { buffer, mimeType: meta.mimeType, fileName: meta.fileName };
  }

  // ---------------------------------------------------------------- logo (kept as named methods for
  // backward compatibility with the existing /business-profile/logo routes and tests)
  uploadLogo(ctx, file) { return this.#uploadAsset(ctx, 'LOGO', file); }
  removeLogo(ctx) { return this.#removeAsset(ctx, 'LOGO'); }
  getLogo(ctx) { return this.#getAsset(ctx, 'LOGO'); }

  // ---------------------------------------------------------------- Phase 22 letterhead assets
  uploadBackground(ctx, file) { return this.#uploadAsset(ctx, 'BACKGROUND', file); }
  removeBackground(ctx) { return this.#removeAsset(ctx, 'BACKGROUND'); }
  getBackground(ctx) { return this.#getAsset(ctx, 'BACKGROUND'); }

  uploadWatermark(ctx, file) { return this.#uploadAsset(ctx, 'WATERMARK', file); }
  removeWatermark(ctx) { return this.#removeAsset(ctx, 'WATERMARK'); }
  getWatermark(ctx) { return this.#getAsset(ctx, 'WATERMARK'); }

  uploadSignature(ctx, file) { return this.#uploadAsset(ctx, 'SIGNATURE', file); }
  removeSignature(ctx) { return this.#removeAsset(ctx, 'SIGNATURE'); }
  getSignature(ctx) { return this.#getAsset(ctx, 'SIGNATURE'); }

  uploadSeal(ctx, file) { return this.#uploadAsset(ctx, 'SEAL', file); }
  removeSeal(ctx) { return this.#removeAsset(ctx, 'SEAL'); }
  getSeal(ctx) { return this.#getAsset(ctx, 'SEAL'); }

  uploadQrCode(ctx, file) { return this.#uploadAsset(ctx, 'QR_CODE', file); }
  removeQrCode(ctx) { return this.#removeAsset(ctx, 'QR_CODE'); }
  getQrCode(ctx) { return this.#getAsset(ctx, 'QR_CODE'); }
}
