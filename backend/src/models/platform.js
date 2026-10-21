import mongoose from 'mongoose';
import {
  AUDIT_ACTIONS, CONSENT_STATUS, DATA_REQUEST_TYPE, DATA_REQUEST_STATUS, INCIDENT_STATUS, IDEMPOTENCY_STATUS, SECURITY_EVENT_TYPES,
  NOTIFICATION_TYPE, NOTIFICATION_SEVERITY,
} from '../constants/statuses.js';
import { ROLE_VALUES } from '../constants/roles.js';
import { ObjectId, tenantPlugin, appendOnlyPlugin } from './plugins.js';

const { Schema, model } = mongoose;
const enumOf = (o) => Object.values(o);

const auditLogSchema = new Schema({
  actorId: { type: ObjectId, ref: 'User' },
  actorRole: { type: String, enum: ROLE_VALUES },
  tenantId: { type: ObjectId, ref: 'Tenant', default: null },
  action: { type: String, enum: enumOf(AUDIT_ACTIONS), required: true },
  resourceType: String,
  resourceId: String,
  timestamp: { type: Date, default: Date.now },
  ipAddress: String,
  userAgent: { type: String, maxlength: 300 },
  requestId: String,
  metadata: Schema.Types.Mixed,
});
appendOnlyPlugin(auditLogSchema);
auditLogSchema.index({ tenantId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });

const refreshTokenSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true },
  familyId: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  revokedAt: Date,
  replacedByHash: String,
  createdByIp: String,
  userAgent: { type: String, maxlength: 300 },
}, { timestamps: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1, familyId: 1 });

const consentSchema = new Schema({
  dataPrincipalId: { type: ObjectId, required: true },
  dataPrincipalType: { type: String, enum: ['USER', 'CUSTOMER'], required: true },
  purpose: { type: String, required: true },
  noticeVersionId: { type: ObjectId, ref: 'PrivacyNoticeVersion' },
  noticeVersion: String,
  consentStatus: { type: String, enum: enumOf(CONSENT_STATUS), required: true },
  grantedAt: { type: Date, default: Date.now },
  withdrawnAt: Date,
  source: { type: String, enum: ['WEB', 'API', 'IMPORT', 'OFFLINE'], default: 'WEB' },
}, { timestamps: true });
tenantPlugin(consentSchema);
consentSchema.index({ tenantId: 1, dataPrincipalId: 1, purpose: 1 });

const dataRequestSchema = new Schema({
  requesterId: { type: ObjectId, required: true },
  requesterType: { type: String, enum: ['USER', 'CUSTOMER'], default: 'USER' },
  requestType: { type: String, enum: enumOf(DATA_REQUEST_TYPE), required: true },
  status: { type: String, enum: enumOf(DATA_REQUEST_STATUS), default: DATA_REQUEST_STATUS.RECEIVED },
  dueAt: Date,
  resolvedAt: Date,
  notes: { type: String, maxlength: 2000 },
  handledBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
tenantPlugin(dataRequestSchema);
dataRequestSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

const securityEventSchema = new Schema({
  type: { type: String, enum: enumOf(SECURITY_EVENT_TYPES), required: true },
  severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], default: 'MEDIUM' },
  userId: { type: ObjectId, ref: 'User' },
  tenantId: { type: ObjectId, ref: 'Tenant', default: null },
  ipAddress: String,
  userAgent: { type: String, maxlength: 300 },
  requestId: String,
  details: Schema.Types.Mixed,
  incidentStatus: { type: String, enum: enumOf(INCIDENT_STATUS), default: INCIDENT_STATUS.OPEN },
  isPotentialPersonalDataBreach: { type: Boolean, default: false },
}, { timestamps: true });
securityEventSchema.index({ type: 1, createdAt: -1 });
securityEventSchema.index({ tenantId: 1, createdAt: -1 });
securityEventSchema.index({ incidentStatus: 1, severity: 1 });

/**
 * Phase 9 — persistent in-app notification (extends the Phase 1 placeholder schema that had no repository,
 * service or writer). `recipientUserId` is written ONLY by NotificationService's generation methods, never
 * from API input. `tenantId` stays REQUIRED (tenantPlugin): every wired event has a tenant context, and
 * tests/unit/models.test.js asserts tenant-owned models require it — so platform-wide (tenantless)
 * notifications are intentionally not supported. `dedupKey` + the unique index below make generation
 * idempotent per recipient per event occurrence. External delivery (EMAIL/SMS) stays behind the
 * unimplemented integrations/notifications/notification.adapter.js port; only IN_APP is produced.
 */
const notificationSchema = new Schema({
  recipientUserId: { type: ObjectId, ref: 'User', required: true },
  channel: { type: String, enum: ['IN_APP', 'EMAIL', 'SMS'], default: 'IN_APP' },
  type: { type: String, enum: enumOf(NOTIFICATION_TYPE), required: true },
  title: { type: String, required: true, maxlength: 200 },
  message: { type: String, maxlength: 1000 },
  severity: { type: String, enum: enumOf(NOTIFICATION_SEVERITY), default: NOTIFICATION_SEVERITY.INFO },
  entityType: { type: String, maxlength: 60 },
  entityId: { type: ObjectId },
  actionUrl: { type: String, maxlength: 300 },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
  dedupKey: { type: String, required: true, maxlength: 300 },
}, { timestamps: true });
tenantPlugin(notificationSchema);
notificationSchema.index({ recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ recipientUserId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, createdAt: -1 });
notificationSchema.index({ recipientUserId: 1, dedupKey: 1 }, { unique: true });

const fileMetadataSchema = new Schema({
  uploadedBy: { type: ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true, maxlength: 255 },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true, max: 10 * 1024 * 1024 },
  storageProvider: { type: String, enum: ['LOCAL_DEV', 'S3'], default: 'LOCAL_DEV' },
  storageKey: { type: String, required: true },
  checksum: { type: String, required: true },
  // Phase 15 adds 'BILL_DOCUMENT' for client-uploaded bill/supporting documents (reuses this same Phase 5
  // storage + metadata architecture rather than a second file-storage system). Phase 19 adds
  // 'GST_BILL_DOCUMENT' for the GST Bill Builder's "Upload Bill" attachment. Phase 21 adds
  // 'VENDOR_FINAL_DOCUMENT' for the GST_VENDOR's final processed document — a DIFFERENT document, by a
  // different author, from the client's own 'GST_BILL_DOCUMENT' (see GSTBill.finalDocumentIds doc comment).
  purpose: {
    type: String,
    enum: [
      'INVOICE_PDF', 'GST_DOCUMENT', 'LOGO', 'BILL_DOCUMENT', 'GST_BILL_DOCUMENT', 'VENDOR_FINAL_DOCUMENT',
      // Phase 22: Company Letterhead Management assets.
      'LETTERHEAD_BACKGROUND', 'LETTERHEAD_WATERMARK', 'LETTERHEAD_SIGNATURE', 'LETTERHEAD_SEAL', 'LETTERHEAD_QR_CODE',
      'OTHER',
    ],
    default: 'OTHER',
  },
  scanStatus: { type: String, enum: ['PENDING', 'CLEAN', 'INFECTED'], default: 'PENDING' },
  /** Optional owning-entity link (Phase 15: BILL_INTAKE; Phase 19: GST_BILL). Unset for file purposes that don't need it (e.g. LOGO). */
  entityType: { type: String, enum: ['BILL_INTAKE', 'GST_BILL'], default: undefined },
  entityId: { type: ObjectId, default: undefined },
}, { timestamps: true });
tenantPlugin(fileMetadataSchema);
fileMetadataSchema.index({ tenantId: 1, purpose: 1, createdAt: -1 });
fileMetadataSchema.index({ tenantId: 1, storageKey: 1 }, { unique: true });
fileMetadataSchema.index({ tenantId: 1, entityType: 1, entityId: 1 });

const privacyNoticeSchema = new Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  currentVersion: String,
}, { timestamps: true });

const privacyNoticeVersionSchema = new Schema({
  noticeId: { type: ObjectId, ref: 'PrivacyNotice', required: true },
  version: { type: String, required: true },
  language: { type: String, default: 'en' },
  content: { type: String, required: true },
  effectiveFrom: { type: Date, required: true },
  publishedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
appendOnlyPlugin(privacyNoticeVersionSchema);
privacyNoticeVersionSchema.index({ noticeId: 1, version: 1, language: 1 }, { unique: true });

const counterSchema = new Schema({
  tenantId: { type: ObjectId, default: null },
  name: { type: String, required: true },
  seq: { type: Number, default: 0 },
});
counterSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const idempotencySchema = new Schema({
  tenantId: { type: ObjectId, required: true },
  scope: { type: String, required: true },
  key: { type: String, required: true, maxlength: 128 },
  requestHash: { type: String, required: true },
  status: { type: String, enum: enumOf(IDEMPOTENCY_STATUS), default: IDEMPOTENCY_STATUS.IN_PROGRESS },
  responseStatus: Number,
  responseBody: Schema.Types.Mixed,
  expiresAt: { type: Date, required: true },
}, { timestamps: true });
idempotencySchema.index({ tenantId: 1, scope: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const retentionPolicySchema = new Schema({
  tenantId: { type: ObjectId, default: null },
  dataCategory: { type: String, required: true },
  retentionDays: { type: Number, required: true, min: 1 },
  action: { type: String, enum: ['DELETE', 'ANONYMIZE', 'ARCHIVE'], required: true },
  legalBasis: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });
retentionPolicySchema.index({ tenantId: 1, dataCategory: 1 }, { unique: true });

const dataProcessorSchema = new Schema({
  name: { type: String, required: true },
  purpose: { type: String, required: true },
  dataCategories: [String],
  country: String,
  contractReference: String,
  status: { type: String, enum: ['ACTIVE', 'UNDER_REVIEW', 'TERMINATED'], default: 'UNDER_REVIEW' },
}, { timestamps: true });
dataProcessorSchema.index({ name: 1 }, { unique: true });

export const platformModels = {
  AuditLog: model('AuditLog', auditLogSchema),
  RefreshToken: model('RefreshToken', refreshTokenSchema),
  ConsentRecord: model('ConsentRecord', consentSchema),
  DataRequest: model('DataRequest', dataRequestSchema),
  SecurityEvent: model('SecurityEvent', securityEventSchema),
  Notification: model('Notification', notificationSchema),
  FileMetadata: model('FileMetadata', fileMetadataSchema),
  PrivacyNotice: model('PrivacyNotice', privacyNoticeSchema),
  PrivacyNoticeVersion: model('PrivacyNoticeVersion', privacyNoticeVersionSchema),
  Counter: model('Counter', counterSchema),
  IdempotencyKey: model('IdempotencyKey', idempotencySchema),
  RetentionPolicy: model('RetentionPolicy', retentionPolicySchema),
  DataProcessor: model('DataProcessor', dataProcessorSchema),
};
