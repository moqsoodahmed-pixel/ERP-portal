import mongoose from 'mongoose';
import { ObjectId, tenantPlugin, actorPlugin } from './plugins.js';
import { DOCUMENT_TYPE, ENTITY_TYPE, DOCUMENT_STATUS } from '../constants/statuses.js';

const { Schema, model } = mongoose;
const enumOf = (o) => Object.values(o);

/**
 * Generic tenant-scoped document-metadata record. The PDF bytes themselves live in the StorageService
 * (local filesystem by default); this model only ever holds metadata + a pointer (storageKey) to them.
 * Exactly one "current" row exists per (tenantId, entityType, entityId, documentType) — enforced by the
 * unique index below — and is updated in place when the underlying invoice status changes or an explicit
 * regeneration is requested, rather than growing a new row per generation.
 */
const documentSchema = new Schema({
  documentType: { type: String, enum: enumOf(DOCUMENT_TYPE), required: true },
  entityType: { type: String, enum: enumOf(ENTITY_TYPE), required: true },
  entityId: { type: ObjectId, required: true },
  fileName: { type: String, required: true, maxlength: 200 },
  mimeType: { type: String, required: true, default: 'application/pdf' },
  storageProvider: { type: String, enum: ['LOCAL'], default: 'LOCAL' },
  storageKey: { type: String, required: true },
  fileSize: { type: Number, required: true, min: 0 },
  checksum: { type: String, required: true },
  version: { type: Number, default: 1 },
  status: { type: String, enum: enumOf(DOCUMENT_STATUS), default: DOCUMENT_STATUS.AVAILABLE },
  /** The invoiceStatus the stored bytes were rendered for (DRAFT/ISSUED/CANCELLED) — drives idempotent reuse vs. regeneration. */
  generatedForStatus: { type: String, required: true },
  generatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });

tenantPlugin(documentSchema);
actorPlugin(documentSchema);
documentSchema.index({ tenantId: 1, entityType: 1, entityId: 1, documentType: 1 }, { unique: true });

export const documentModels = {
  Document: model('Document', documentSchema),
};
