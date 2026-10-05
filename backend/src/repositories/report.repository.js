import mongoose from 'mongoose';
import { TenantAccessError } from '../utils/errors.js';
import { isObjectId } from '../utils/objectId.js';

/** Aggregation pipelines are NOT cast by Mongoose, so ids must be real ObjectIds in every $match. */
export const toOid = (id) => new mongoose.Types.ObjectId(String(id));

const SOFT_DELETE_MODELS = new Set(['Invoice', 'Customer', 'Product']);

/**
 * Phase 9 — reusable, tenant-scoped read/aggregation layer shared by every report and dashboard.
 *
 * Scope contract (enforced here, not by callers):
 *  - `{ tenantIds: [...] }` — the ONLY form available to tenant/vendor code paths. The ids are resolved
 *    server-side (resolveTenant / requireVendorAssignment / the vendor's own ACTIVE assignments) before they
 *    reach this layer. An empty list matches nothing (e.g. a vendor with no active assignments).
 *  - `{ allTenants: true }` — platform-wide; only ever passed by Master-Admin-only routes.
 * The tenant condition is always the FIRST pipeline stage's `$match`, and it is applied after the caller's
 * extra conditions so it can never be overridden. Soft-deleted rows are excluded for soft-delete models.
 */
export class ReportRepository {
  constructor(models) { this.models = models; }

  model(name) {
    const m = this.models[name];
    if (!m) throw new Error(`ReportRepository: unknown model ${name}`);
    return m;
  }

  collectionName(name) { const m = this.model(name); return m.collection?.name ?? m.name; }

  match(name, scope, extra = {}) {
    let tenantCond;
    if (scope?.allTenants === true) tenantCond = undefined;
    else if (Array.isArray(scope?.tenantIds)) {
      if (!scope.tenantIds.every(isObjectId)) throw new TenantAccessError('Invalid tenant scope');
      tenantCond = { $in: scope.tenantIds.map(toOid) };
    } else throw new TenantAccessError('Missing tenant scope');
    const { tenantId: _ignored, ...rest } = extra;
    const out = {};
    if (tenantCond) out.tenantId = tenantCond;
    Object.assign(out, rest);
    if (SOFT_DELETE_MODELS.has(name) && out.isDeleted === undefined) out.isDeleted = { $ne: true };
    if (tenantCond) out.tenantId = tenantCond; // re-applied last: callers can never override the scope
    return out;
  }

  aggregate(name, scope, extra, stages = []) {
    return this.model(name).aggregate([{ $match: this.match(name, scope, extra) }, ...stages]);
  }

  find(name, scope, extra, { sort = { createdAt: -1 }, skip = 0, limit } = {}) {
    let q = this.model(name).find(this.match(name, scope, extra)).sort(sort).skip(skip);
    if (limit) q = q.limit(limit);
    return q.lean();
  }

  count(name, scope, extra) { return this.model(name).countDocuments(this.match(name, scope, extra)); }

  /** Batch lookup by id within the same scope (used to decorate a page of rows without N+1 queries). */
  async byIds(name, scope, ids) {
    const unique = [...new Set(ids.filter(Boolean).map(String))].filter(isObjectId);
    if (!unique.length) return new Map();
    const docs = await this.model(name).find(this.match(name, scope, { _id: { $in: unique } })).lean();
    return new Map(docs.map((d) => [String(d._id), d]));
  }

  /** Business names for tenants that already appear in a scoped result set (cross-tenant Master reports). */
  async tenantNames(ids) {
    const unique = [...new Set(ids.filter(Boolean).map(String))].filter(isObjectId);
    if (!unique.length) return new Map();
    const docs = await this.model('Tenant').find({ _id: { $in: unique } }).select('businessName tenantCode').lean();
    return new Map(docs.map((d) => [String(d._id), d.businessName]));
  }

  /** Display names only (e.g. assigned vendor user on a filing). Users are not tenant-owned, so only `name` is ever returned. */
  async userNames(ids) {
    const unique = [...new Set(ids.filter(Boolean).map(String))].filter(isObjectId);
    if (!unique.length) return new Map();
    const docs = await this.model('User').find({ _id: { $in: unique } }).select('name').lean();
    return new Map(docs.map((d) => [String(d._id), d.name]));
  }
}
