import { TenantRepository } from './tenant.repository.js';
import { isObjectId } from '../utils/objectId.js';

/**
 * Tenant-scoped document-metadata repository. Exactly one "current" row per
 * (tenantId, entityType, entityId, documentType) is enforced by the schema's unique index;
 * findOneAndUpdate + upsert gives atomic "create if absent" semantics so concurrent first-generation
 * requests for the same invoice never produce duplicate rows (a loser hits E11000 and simply re-reads).
 */
export class DocumentRepository extends TenantRepository {
  constructor(model) { super(model, { softDelete: false }); }

  findCurrent(tenantId, entityType, entityId, documentType) {
    if (!isObjectId(entityId)) return null;
    return this.findOne(tenantId, { entityType, entityId: String(entityId), documentType });
  }

  /** Atomic create-if-absent. Returns { doc, created } — created=false means a concurrent writer won the race and this is their row. */
  async createIfAbsent(tenantId, data) {
    const filter = this.scope(tenantId, {
      entityType: data.entityType, entityId: String(data.entityId), documentType: data.documentType,
    });
    try {
      const doc = await this.model.findOneAndUpdate(
        filter, { $setOnInsert: { ...data, tenantId: String(tenantId) } }, { upsert: true, returnDocument: 'after' },
      ).lean();
      const created = String(doc.checksum) === String(data.checksum) && String(doc.storageKey) === String(data.storageKey);
      return { doc, created };
    } catch (err) {
      if (err.code === 11000) {
        const existing = await this.findOne(tenantId, { entityType: data.entityType, entityId: String(data.entityId), documentType: data.documentType });
        return { doc: existing, created: false };
      }
      throw err;
    }
  }

  /** Overwrites the current row in place (status change / explicit regenerate). Never creates a second row. */
  async replaceCurrent(tenantId, id, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id) }, { $set: patch }, { returnDocument: 'after' },
    ).lean();
  }
}
