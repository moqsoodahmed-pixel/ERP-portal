import { BaseRepository, toPlain } from './base.repository.js';
import { TenantAccessError } from '../utils/errors.js';
import { isObjectId } from '../utils/objectId.js';
import { PAGINATION } from '../constants/pagination.js';
import { escapeRegex } from '../utils/pagination.js';

const PROTECTED_FIELDS = ['_id', 'tenantId', 'createdBy', 'createdAt', 'isDeleted', 'deletedAt', 'deletedBy'];

/**
 * Tenant-scoped repository. The ONLY way to read or write tenant-owned data.
 * - tenantId is a mandatory first argument on every method (never read from filters or payloads).
 * - the tenant condition is applied last, so callers cannot override it.
 * - soft-deleted rows are excluded by default.
 */
export class TenantRepository extends BaseRepository {
  constructor(model, { searchFields = [], softDelete = true, dateField = 'createdAt' } = {}) {
    super(model);
    this.searchFields = searchFields;
    this.softDelete = softDelete;
    this.dateField = dateField;
  }

  scope(tenantId, filter = {}) {
    if (!isObjectId(tenantId)) throw new TenantAccessError('Missing or invalid tenant context');
    const { tenantId: _ignored, ...rest } = filter;
    const scoped = { ...rest };
    if (this.softDelete && scoped.isDeleted === undefined) scoped.isDeleted = { $ne: true };
    scoped.tenantId = String(tenantId);
    return scoped;
  }

  async findOneById(tenantId, id) {
    const scoped = this.scope(tenantId);
    if (!isObjectId(id)) return null;
    return this.model.findOne({ ...scoped, _id: String(id) }).lean();
  }

  async findOne(tenantId, filter) { return this.model.findOne(this.scope(tenantId, filter)).lean(); }

  async count(tenantId, filter = {}) { return this.model.countDocuments(this.scope(tenantId, filter)); }

  async findPage(tenantId, { filter = {}, search, sort = { createdAt: -1 }, page = 1, limit = PAGINATION.DEFAULT_LIMIT, skip = 0, dateRange } = {}) {
    const query = this.scope(tenantId, filter);
    if (search && this.searchFields.length) {
      const rx = { $regex: escapeRegex(String(search).slice(0, PAGINATION.MAX_SEARCH_LENGTH)), $options: 'i' };
      query.$or = this.searchFields.map((f) => ({ [f]: rx }));
    }
    if (dateRange?.from || dateRange?.to) {
      query[this.dateField] = {};
      if (dateRange.from) query[this.dateField].$gte = dateRange.from;
      if (dateRange.to) query[this.dateField].$lte = dateRange.to;
    }
    const safeLimit = Math.min(limit, PAGINATION.MAX_LIMIT);
    const [items, total] = await Promise.all([
      this.model.find(query).sort(sort).skip(skip).limit(safeLimit).lean(),
      this.model.countDocuments(query),
    ]);
    return { items, total, page, limit: safeLimit };
  }

  async create(tenantId, data, actorId) {
    if (!isObjectId(tenantId)) throw new TenantAccessError('Missing or invalid tenant context');
    const doc = { ...data, tenantId: String(tenantId) };
    if (actorId) { doc.createdBy = actorId; doc.updatedBy = actorId; }
    return toPlain(await this.model.create(doc));
  }

  async updateById(tenantId, id, patch, actorId) {
    if (!isObjectId(id)) return null;
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => !PROTECTED_FIELDS.includes(k)));
    if (actorId) clean.updatedBy = actorId;
    return this.model.findOneAndUpdate({ ...this.scope(tenantId), _id: String(id) }, { $set: clean }, { returnDocument: 'after' }).lean();
  }

  async softDeleteById(tenantId, id, actorId, extra = {}) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate(
      { ...this.scope(tenantId), _id: String(id) },
      { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId, updatedBy: actorId, ...extra } },
      { returnDocument: 'after' },
    ).lean();
  }
}
