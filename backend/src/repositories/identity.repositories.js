import { BaseRepository, toPlain } from './base.repository.js';
import { TenantRepository } from './tenant.repository.js';
import { isObjectId } from '../utils/objectId.js';
import { PAGINATION } from '../constants/pagination.js';
import { escapeRegex } from '../utils/pagination.js';
import { ASSIGNMENT_STATUS } from '../constants/statuses.js';

export class UserRepository extends TenantRepository {
  constructor(model) { super(model, { searchFields: ['name', 'email'] }); }

  findByEmailWithSecret(email) {
    return this.model.findOne({ email: String(email).toLowerCase(), isDeleted: { $ne: true } }).select('+passwordHash').lean();
  }
  findByEmail(email) { return this.model.findOne({ email: String(email).toLowerCase() }).lean(); }
  /** Auth-time lookup. Not tenant scoped because the tenant is derived FROM this record. */
  findAuthById(id) { return isObjectId(id) ? this.model.findOne({ _id: String(id), isDeleted: { $ne: true } }).select('+passwordHash').lean() : null; }
  async createUnscoped(data) { return toPlain(await this.model.create(data)); }
  updateUnscoped(id, update) { return this.model.findOneAndUpdate({ _id: String(id) }, update, { returnDocument: 'after' }).lean(); }
  async deleteUnscoped(id) { return this.model.deleteOne({ _id: String(id) }); }

  /** Counts, by status, of every (non-deleted) user belonging to a given tenant. Used for Master Admin client summaries. */
  async countsByStatusForTenant(tenantId) {
    const statuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING'];
    const counts = await Promise.all(statuses.map((status) => this.model.countDocuments({ tenantId: String(tenantId), isDeleted: { $ne: true }, status })));
    const byStatus = Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
    return { total: counts.reduce((s, n) => s + n, 0), byStatus };
  }

  /** Platform-wide user counts for the Master dashboard. */
  async globalCounts() {
    const [total, active] = await Promise.all([
      this.model.countDocuments({ isDeleted: { $ne: true } }),
      this.model.countDocuments({ isDeleted: { $ne: true }, status: 'ACTIVE' }),
    ]);
    return { total, active };
  }
}

export class TenantsRepository extends BaseRepository {
  findByCode(code) { return this.model.findOne({ $or: [{ companyCode: code }, { tenantCode: code }] }).lean(); }
  async findPage({ search, status, ids, page, limit, skip, sort = { createdAt: -1 } }) {
    const q = { isDeleted: { $ne: true } };
    if (ids) q._id = { $in: ids };
    if (status) q.status = status;
    if (search) {
      const rx = { $regex: escapeRegex(String(search).slice(0, PAGINATION.MAX_SEARCH_LENGTH)), $options: 'i' };
      q.$or = [{ businessName: rx }, { tenantCode: rx }, { companyCode: rx }, { gstin: rx }];
    }
    const [items, total] = await Promise.all([
      this.model.find(q).sort(sort).skip(skip).limit(limit).lean(), this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }
  countByStatus(status) { return this.model.countDocuments({ status, isDeleted: { $ne: true } }); }
  async deleteHard(id) { return this.model.deleteOne({ _id: String(id) }); }
}

export class VendorRepository extends BaseRepository {
  async findPage({ search, page, limit, skip }) {
    const q = { isDeleted: { $ne: true } };
    if (search) q.name = { $regex: escapeRegex(String(search).slice(0, PAGINATION.MAX_SEARCH_LENGTH)), $options: 'i' };
    const [items, total] = await Promise.all([
      this.model.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), this.model.countDocuments(q),
    ]);
    return { items, total, page, limit };
  }
  countAll() { return this.model.countDocuments({ isDeleted: { $ne: true } }); }
}

export class AssignmentRepository extends BaseRepository {
  findActive(vendorId, tenantId) {
    if (!isObjectId(vendorId) || !isObjectId(tenantId)) return null;
    return this.model.findOne({ vendorId: String(vendorId), tenantId: String(tenantId), status: ASSIGNMENT_STATUS.ACTIVE }).lean();
  }
  listActiveByVendor(vendorId) { return this.model.find({ vendorId: String(vendorId), status: ASSIGNMENT_STATUS.ACTIVE }).lean(); }
  countActive() { return this.model.countDocuments({ status: ASSIGNMENT_STATUS.ACTIVE }); }
  countActiveForTenant(tenantId) { return this.model.countDocuments({ tenantId: String(tenantId), status: ASSIGNMENT_STATUS.ACTIVE }); }
  unassign(vendorId, tenantId, actorId, reason) {
    return this.model.findOneAndUpdate(
      { vendorId: String(vendorId), tenantId: String(tenantId), status: ASSIGNMENT_STATUS.ACTIVE },
      { $set: { status: ASSIGNMENT_STATUS.INACTIVE, unassignedAt: new Date(), unassignedBy: actorId, deactivationReason: reason ?? null } },
      { returnDocument: 'after' },
    ).lean();
  }
  /** Reactivates the most recent INACTIVE assignment for this (vendor, tenant) pair, if any. */
  reactivateLatest(vendorId, tenantId, actorId) {
    return this.model.findOneAndUpdate(
      { vendorId: String(vendorId), tenantId: String(tenantId), status: ASSIGNMENT_STATUS.INACTIVE },
      { $set: { status: ASSIGNMENT_STATUS.ACTIVE, reactivatedAt: new Date(), reactivatedBy: actorId }, $unset: { deactivationReason: 1 } },
      { returnDocument: 'after', sort: { updatedAt: -1 } },
    ).lean();
  }
  byId(assignmentId) { return isObjectId(assignmentId) ? this.model.findOne({ _id: String(assignmentId) }).lean() : null; }
  listForVendor(vendorId) { return this.model.find({ vendorId: String(vendorId) }).sort({ createdAt: -1 }).lean(); }
  listForTenant(tenantId) { return this.model.find({ tenantId: String(tenantId) }).sort({ createdAt: -1 }).lean(); }
}

export class RoleRepository extends BaseRepository {
  findByIds(ids, tenantId) {
    return this.model.find({ _id: { $in: ids.map(String) }, tenantId: { $in: [null, tenantId ? String(tenantId) : null] } }).lean();
  }
}

export class UserRoleRepository extends BaseRepository {
  findByUserId(userId) { return this.model.find({ userId: String(userId) }).lean(); }
}
