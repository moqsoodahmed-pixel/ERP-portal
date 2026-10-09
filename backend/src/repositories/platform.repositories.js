import { BaseRepository, toPlain } from './base.repository.js';
import { isObjectId } from '../utils/objectId.js';

export class AuditRepository extends BaseRepository {
  /** Append-only: only create + read are exposed. */
  async append(entry) { return toPlain(await this.model.create(entry)); }
  async findPage({ tenantId, action, actorId, from, to, page, limit, skip }) {
    const q = {};
    if (tenantId) q.tenantId = String(tenantId);
    if (action) q.action = action;
    if (actorId && isObjectId(actorId)) q.actorId = String(actorId);
    if (from || to) { q.timestamp = {}; if (from) q.timestamp.$gte = from; if (to) q.timestamp.$lte = to; }
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(), this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }
}

export class RefreshTokenRepository extends BaseRepository {
  findByHash(tokenHash) { return this.model.findOne({ tokenHash }).lean(); }
  markRotated(tokenHash, replacedByHash) {
    return this.model.findOneAndUpdate({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date(), replacedByHash } }, { returnDocument: 'after' }).lean();
  }
  revoke(tokenHash) {
    return this.model.findOneAndUpdate({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } }, { returnDocument: 'after' }).lean();
  }
  revokeFamily(userId, familyId) {
    return this.model.updateMany({ userId: String(userId), familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
  revokeAllForUser(userId) {
    return this.model.updateMany({ userId: String(userId), revokedAt: null }, { $set: { revokedAt: new Date() } });
  }
}

export class SecurityEventRepository extends BaseRepository {
  /** Simple count for the Master dashboard (no viewer is built here). */
  countInRange(from, to, extra = {}) { return this.model.countDocuments({ ...extra, createdAt: { $gte: from, $lte: to } }); }
}

/**
 * Phase 9 notifications. Every READ/UPDATE method takes the recipient's userId as a mandatory first
 * argument and applies it inside the filter (the same "scope is applied by the repository, never by the
 * caller's filter" rule TenantRepository uses for tenantId) — so a notification id belonging to someone
 * else simply does not exist for the caller (IDOR guard).
 */
export class NotificationRepository extends BaseRepository {
  scope(recipientUserId, filter = {}) {
    if (!isObjectId(recipientUserId)) throw new Error('NotificationRepository: missing recipient scope');
    const { recipientUserId: _ignored, ...rest } = filter;
    return { ...rest, recipientUserId: String(recipientUserId) };
  }

  /** Insert-if-absent keyed by (recipientUserId, dedupKey). Returns null when it already existed (duplicate event). */
  async createOnce(data) {
    try {
      return toPlain(await this.model.create(data));
    } catch (err) {
      if (err.code === 11000) return null;
      throw err;
    }
  }

  async findPageForRecipient(recipientUserId, { unreadOnly, skip, limit }) {
    const q = this.scope(recipientUserId, unreadOnly ? { isRead: false } : {});
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), this.model.countDocuments(q),
    ]);
    return { items, total };
  }

  countUnread(recipientUserId) { return this.model.countDocuments(this.scope(recipientUserId, { isRead: false })); }

  findOneForRecipient(recipientUserId, id) {
    if (!isObjectId(id)) return null;
    return this.model.findOne(this.scope(recipientUserId, { _id: String(id) })).lean();
  }

  /** Atomic unread->read flip; the isRead:false precondition means concurrent calls set readAt exactly once. */
  markRead(recipientUserId, id, at = new Date()) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      this.scope(recipientUserId, { _id: String(id), isRead: false }), { $set: { isRead: true, readAt: at } }, { returnDocument: 'after' },
    ).lean();
  }

  markAllRead(recipientUserId, at = new Date()) {
    return this.model.updateMany(this.scope(recipientUserId, { isRead: false }), { $set: { isRead: true, readAt: at } });
  }

  /** Test/diagnostic helper: count for an exact (recipient, dedupKey) pair. */
  countByDedupKey(recipientUserId, dedupKey) { return this.model.countDocuments(this.scope(recipientUserId, { dedupKey })); }
}

export class CounterRepository extends BaseRepository {
  /** Atomic per-tenant sequence (race-free code generation). */
  async next(tenantId, name) {
    const doc = await this.model.findOneAndUpdate(
      { tenantId: tenantId ? String(tenantId) : null, name }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true },
    ).lean();
    return doc.seq;
  }
}

/**
 * Phase 15: file uploads (bill + supporting documents). Reuses the Phase 5 FileMetadata model/collection —
 * scoped reads/writes always include tenantId so a document id from another tenant is indistinguishable
 * from a missing one (same IDOR-proofing discipline as every other tenant-scoped repository).
 */
export class FileMetadataRepository extends BaseRepository {
  scopeTenant(tenantId, filter = {}) {
    if (!isObjectId(tenantId)) throw new Error('FileMetadataRepository: missing tenant context');
    const { tenantId: _ignored, ...rest } = filter;
    return { ...rest, tenantId: String(tenantId) };
  }

  async findOneForTenant(tenantId, id) {
    if (!isObjectId(id)) return null;
    return this.model.findOne(this.scopeTenant(tenantId, { _id: String(id) })).lean();
  }

  async findManyForTenant(tenantId, ids) {
    const valid = [...new Set((ids ?? []).map(String))].filter(isObjectId);
    if (!valid.length) return [];
    return this.model.find(this.scopeTenant(tenantId, { _id: { $in: valid } })).lean();
  }

  async createForTenant(tenantId, data) { return toPlain(await this.model.create({ ...data, tenantId: String(tenantId) })); }

  async deleteForTenant(tenantId, id) {
    if (!isObjectId(id)) return;
    await this.model.deleteOne(this.scopeTenant(tenantId, { _id: String(id) }));
  }
}

export class IdempotencyRepository extends BaseRepository {
  async reserve(data) { return toPlain(await this.model.create(data)); }
  find(tenantId, scope, key) { return this.model.findOne({ tenantId: String(tenantId), scope, key }).lean(); }
  complete(id, responseStatus, responseBody) {
    return this.model.findOneAndUpdate({ _id: String(id) }, { $set: { status: 'COMPLETED', responseStatus, responseBody } }, { returnDocument: 'after' }).lean();
  }
  release(id) { return this.model.deleteOne({ _id: String(id) }); }
}
