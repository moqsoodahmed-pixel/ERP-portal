import { isObjectId } from '../utils/objectId.js';

export const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/** Non-tenant-scoped data access. Use only for platform-level collections (tenants, vendors, tokens, audit...). */
export class BaseRepository {
  constructor(model) { this.model = model; }

  async findById(id) {
    if (!isObjectId(id)) return null;
    return this.model.findOne({ _id: String(id) }).lean();
  }

  async findByIds(ids) {
    const valid = [...new Set(ids.map(String))].filter(isObjectId);
    if (!valid.length) return [];
    return this.model.find({ _id: { $in: valid } }).lean();
  }

  async create(data) { return toPlain(await this.model.create(data)); }

  async updateById(id, patch) {
    if (!isObjectId(id)) return null;
    return this.model.findOneAndUpdate({ _id: String(id) }, { $set: patch }, { returnDocument: 'after' }).lean();
  }
}
