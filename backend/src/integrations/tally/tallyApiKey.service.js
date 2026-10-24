import crypto from 'node:crypto';
import { AUDIT_ACTIONS, TALLY_API_KEY_STATUS } from '../../constants/statuses.js';
import { AuthenticationError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { generateApiKey, hashApiKey, isWellFormedApiKey } from '../../security/apiKey.js';
import { TALLY_API_SCOPES } from './tally.constants.js';

/** Fields a list/detail view may return. The raw key and its hash never appear here. */
const toView = (doc) => ({
  id: doc._id,
  name: doc.name,
  keyPrefix: doc.keyPrefix,
  status: doc.status,
  scopes: doc.scopes ?? [],
  ipAllowList: doc.ipAllowList ?? [],
  lastUsedAt: doc.lastUsedAt ?? null,
  expiresAt: doc.expiresAt ?? null,
  revokedAt: doc.revokedAt ?? null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

/**
 * Phase 13 — Tally Public API key lifecycle (create/list/revoke/rotate) and the authentication lookup
 * used by middlewares/tallyApiAuth.js. This is the Tally/TDL -> ERP direction; it does not touch
 * TallyConfigService/TallySyncService (the existing ERP -> Tally direction), it only ends up CALLING
 * TallySyncService for the sync endpoint (see tallyPublicApi.service.js), never duplicating its logic.
 */
export class TallyApiKeyService {
  constructor({ tallyApiKeyRepo, auditService, securityService, encryption = null }) {
    Object.assign(this, { tallyApiKeyRepo, auditService, securityService, encryption });
  }

  async list(ctx) {
    const docs = await this.tallyApiKeyRepo.listByTenant(ctx.tenantId);
    return docs.map(toView);
  }

  async get(ctx, id) {
    const doc = await this.tallyApiKeyRepo.findOneById(ctx.tenantId, id);
    if (!doc) throw new NotFoundError('API key not found');
    return toView(doc);
  }

  _validateScopes(scopes) {
    const list = Array.isArray(scopes) ? [...new Set(scopes)] : [];
    const invalid = list.filter((s) => !TALLY_API_SCOPES.includes(s));
    if (invalid.length) throw new ValidationError(`Unknown scope(s): ${invalid.join(', ')}`);
    return list;
  }

  /** Raw key and raw secret are returned ONLY here (and from rotate()) — never again afterwards, by design. */
  async create(ctx, { name, scopes, expiresAt, ipAllowList }) {
    const { key, keyPrefix } = generateApiKey();
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = hashApiKey(rawSecret);
    const encryptedSecret = this.encryption ? this.encryption.encrypt(rawSecret) : null;

    const doc = await this.tallyApiKeyRepo.create(ctx.tenantId, {
      name,
      keyPrefix,
      keyHash: hashApiKey(key),
      secretHash,
      encryptedSecret,
      ipAllowList: Array.isArray(ipAllowList) ? ipAllowList : [],
      scopes: this._validateScopes(scopes),
      expiresAt: expiresAt ?? undefined,
      status: TALLY_API_KEY_STATUS.ACTIVE,
    }, ctx.actor.id);

    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_API_KEY_CREATED, resourceType: 'TallyApiKey', resourceId: doc._id,
      metadata: { name: doc.name, scopes: doc.scopes, keyPrefix: doc.keyPrefix },
    });
    return { ...toView(doc), key, secret: rawSecret };
  }

  async revoke(ctx, id) {
    const existing = await this.tallyApiKeyRepo.findOneById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError('API key not found');
    const updated = await this.tallyApiKeyRepo.updateById(ctx.tenantId, id, {
      status: TALLY_API_KEY_STATUS.REVOKED, revokedAt: new Date(), revokedBy: ctx.actor.id,
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_API_KEY_REVOKED, resourceType: 'TallyApiKey', resourceId: id, metadata: { name: existing.name } });
    return toView(updated ?? existing);
  }

  /** Rotation = same record identity (id/name/scopes preserved), new secret. The old raw key stops working immediately. */
  async rotate(ctx, id) {
    const existing = await this.tallyApiKeyRepo.findOneById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError('API key not found');
    const { key, keyPrefix } = generateApiKey();
    const rawSecret = crypto.randomBytes(32).toString('hex');
    const secretHash = hashApiKey(rawSecret);
    const encryptedSecret = this.encryption ? this.encryption.encrypt(rawSecret) : null;

    const updated = await this.tallyApiKeyRepo.updateById(ctx.tenantId, id, {
      keyPrefix,
      keyHash: hashApiKey(key),
      secretHash,
      encryptedSecret,
      status: TALLY_API_KEY_STATUS.ACTIVE,
      revokedAt: null,
      revokedBy: null,
      lastUsedAt: null,
    }, ctx.actor.id);

    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_API_KEY_ROTATED, resourceType: 'TallyApiKey', resourceId: id, metadata: { name: existing.name, keyPrefix } });
    return { ...toView(updated), key, secret: rawSecret };
  }

  /** Decrypts and retrieves the raw secret for an API key if encrypted storage is available. */
  getSecret(doc) {
    if (doc.encryptedSecret && this.encryption) {
      try {
        return this.encryption.decrypt(doc.encryptedSecret);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Authenticates an inbound Tally/TDL request. Resolves the tenant FROM the key — never trusts any
   * tenantId the caller might also send. A single generic failure (AuthenticationError) covers every
   * rejection reason (missing/malformed/unknown/revoked/expired) so a prober cannot distinguish them.
   */
  async authenticate(rawKey, ctx) {
    const fail = async (reason) => {
      await this.securityService.record('TALLY_API_KEY_AUTH_FAILED', ctx, { severity: 'LOW', details: { reason } });
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_API_KEY_AUTH_FAILED, resourceType: 'TallyApiKey', metadata: { reason } });
      throw new AuthenticationError('Invalid or missing API key', 'TALLY_API_KEY_INVALID');
    };
    if (!isWellFormedApiKey(rawKey)) return fail('MALFORMED');
    const doc = await this.tallyApiKeyRepo.findByHash(hashApiKey(rawKey));
    if (!doc) return fail('NOT_FOUND');
    if (doc.status === TALLY_API_KEY_STATUS.REVOKED) return fail('REVOKED');
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
      if (doc.status === TALLY_API_KEY_STATUS.ACTIVE) {
        const expired = await this.tallyApiKeyRepo.markExpired(doc._id);
        if (expired) await this.auditService.record({ ...ctx, tenantId: doc.tenantId }, { action: AUDIT_ACTIONS.TALLY_API_KEY_EXPIRED, resourceType: 'TallyApiKey', resourceId: doc._id, metadata: { name: doc.name } });
      }
      return fail('EXPIRED');
    }
    if (doc.status !== TALLY_API_KEY_STATUS.ACTIVE) return fail('INACTIVE');
    await this.tallyApiKeyRepo.touchLastUsed(doc._id);
    return { tenantId: String(doc.tenantId), apiKeyId: String(doc._id), scopes: new Set(doc.scopes ?? []), name: doc.name };
  }
}
