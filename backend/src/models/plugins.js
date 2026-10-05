import mongoose from 'mongoose';

const { Schema } = mongoose;
export const { ObjectId } = Schema.Types;
export const Money = Schema.Types.Decimal128;

/** Every tenant-owned document carries a required, indexed tenantId. */
export function tenantPlugin(schema, { unique = false } = {}) {
  schema.add({ tenantId: { type: ObjectId, ref: 'Tenant', required: true, ...(unique ? { unique: true } : { index: true }) } });
}

export function softDeletePlugin(schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: ObjectId, ref: 'User', default: null },
  });
}

export function actorPlugin(schema) {
  schema.add({ createdBy: { type: ObjectId, ref: 'User' }, updatedBy: { type: ObjectId, ref: 'User' } });
}

/** Blocks update/delete operations so the collection is append-only at the application layer. */
export function appendOnlyPlugin(schema) {
  const blocked = [
    'updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne',
    'deleteOne', 'deleteMany', 'findOneAndDelete',
  ];
  for (const op of blocked) {
    schema.pre(op, () => { throw new Error(`Append-only collection: ${op} is not permitted`); });
  }
  schema.pre('save', function guard() {
    if (!this.isNew) throw new Error('Append-only collection: documents cannot be modified');
  });
}

export const addressSchema = new Schema({
  line1: String, line2: String, city: String, state: String, stateCode: String,
  pincode: { type: String, match: /^\d{6}$/ }, country: { type: String, default: 'IN' },
}, { _id: false });

export const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;
