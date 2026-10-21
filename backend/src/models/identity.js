import mongoose from 'mongoose';
import { ROLE_VALUES } from '../constants/roles.js';
import { USER_STATUS, TENANT_STATUS, ASSIGNMENT_STATUS } from '../constants/statuses.js';
import { ObjectId, tenantPlugin, softDeletePlugin, addressSchema, GSTIN_REGEX, PAN_REGEX } from './plugins.js';

const { Schema, model } = mongoose;
const enumOf = (o) => Object.values(o);

const userSchema = new Schema({
  tenantId: { type: ObjectId, ref: 'Tenant', default: null },
  vendorId: { type: ObjectId, ref: 'Vendor', default: null },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  phone: { type: String, trim: true, maxlength: 20 },
  isEmailVerified: { type: Boolean, default: false },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: { type: Date, default: Date.now },
  role: { type: String, enum: ROLE_VALUES, required: true },
  grantedPermissions: { type: [String], default: [] },
  status: { type: String, enum: enumOf(USER_STATUS), default: USER_STATUS.ACTIVE },
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },
  lastLoginAt: Date,
  tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });
softDeletePlugin(userSchema);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, status: 1 });
userSchema.index({ tenantId: 1, createdAt: -1 });
userSchema.index({ vendorId: 1 }, { sparse: true });

const roleSchema = new Schema({
  tenantId: { type: ObjectId, ref: 'Tenant', default: null },
  name: { type: String, required: true },
  description: String,
  permissions: { type: [String], default: [] },
  isSystem: { type: Boolean, default: false },
}, { timestamps: true });
roleSchema.index({ tenantId: 1, name: 1 }, { unique: true });

const permissionSchema = new Schema({
  key: { type: String, required: true, unique: true },
  module: { type: String, required: true },
  description: String,
}, { timestamps: true });

const userRoleSchema = new Schema({
  userId: { type: ObjectId, ref: 'User', required: true },
  roleId: { type: ObjectId, ref: 'Role', required: true },
  tenantId: { type: ObjectId, ref: 'Tenant', default: null },
  assignedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
userRoleSchema.index({ userId: 1, roleId: 1 }, { unique: true });

const tenantSchema = new Schema({
  tenantCode: { type: String, required: true, unique: true },
  businessName: { type: String, required: true, trim: true, maxlength: 200 },
  legalName: { type: String, trim: true, maxlength: 200 },
  gstin: { type: String, uppercase: true, match: GSTIN_REGEX },
  pan: { type: String, uppercase: true, match: PAN_REGEX },
  email: { type: String, lowercase: true, trim: true },
  phone: String,
  address: addressSchema,
  status: { type: String, enum: enumOf(TENANT_STATUS), default: TENANT_STATUS.PENDING },
  settings: { currency: { type: String, default: 'INR' }, timezone: { type: String, default: 'Asia/Kolkata' }, financialYearStartMonth: { type: Number, default: 4 } },
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
softDeletePlugin(tenantSchema);
tenantSchema.index({ status: 1, createdAt: -1 });
tenantSchema.index({ gstin: 1 }, { unique: true, partialFilterExpression: { gstin: { $type: 'string' } } });

/** Phase 22 — Company Letterhead Management. Bank details printed on invoices/credit-notes/debit-notes. */
const bankDetailsSchema = new Schema({
  accountName: { type: String, trim: true, maxlength: 200 },
  accountNumber: { type: String, trim: true, maxlength: 40 },
  ifsc: { type: String, trim: true, uppercase: true, maxlength: 20 },
  bankName: { type: String, trim: true, maxlength: 200 },
  branch: { type: String, trim: true, maxlength: 200 },
}, { _id: false });

const businessProfileSchema = new Schema({
  displayName: { type: String, required: true },
  gstin: { type: String, uppercase: true, match: GSTIN_REGEX },
  address: addressSchema,
  mobile: String,
  email: { type: String, lowercase: true },
  website: String,
  logoFileId: { type: ObjectId, ref: 'FileMetadata' },
  // Phase 22 — Letterhead assets. Each follows the exact same FileMetadata + StorageService pattern as
  // logoFileId above (see businessProfile.service.js) — never stored inline/base64 in Mongo.
  letterheadBackgroundFileId: { type: ObjectId, ref: 'FileMetadata' },
  watermarkFileId: { type: ObjectId, ref: 'FileMetadata' },
  signatureFileId: { type: ObjectId, ref: 'FileMetadata' },
  sealFileId: { type: ObjectId, ref: 'FileMetadata' },
  qrCodeFileId: { type: ObjectId, ref: 'FileMetadata' },
  bankDetails: bankDetailsSchema,
  footerText: { type: String, maxlength: 1000 },
  defaultTermsAndConditions: { type: String, maxlength: 2000 },
  declaration: { type: String, maxlength: 1000 },
  authorizedSignatoryName: { type: String, trim: true, maxlength: 120 },
  authorizedSignatoryDesignation: { type: String, trim: true, maxlength: 120 },
  offerings: { type: [String], enum: ['PRODUCT', 'SERVICE'], default: ['PRODUCT'] },
}, { timestamps: true });
tenantPlugin(businessProfileSchema, { unique: true });

const vendorSchema = new Schema({
  vendorCode: { type: String, required: true, unique: true },
  name: { type: String, required: true, trim: true },
  contactEmail: { type: String, lowercase: true },
  phone: String,
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
softDeletePlugin(vendorSchema);
vendorSchema.index({ status: 1, createdAt: -1 });

const assignmentSchema = new Schema({
  vendorId: { type: ObjectId, ref: 'Vendor', required: true },
  tenantId: { type: ObjectId, ref: 'Tenant', required: true },
  assignedBy: { type: ObjectId, ref: 'User', required: true },
  status: { type: String, enum: enumOf(ASSIGNMENT_STATUS), default: ASSIGNMENT_STATUS.ACTIVE },
  assignedAt: { type: Date, default: Date.now },
  unassignedAt: Date,
  unassignedBy: { type: ObjectId, ref: 'User' },
  deactivationReason: String,
  reactivatedAt: Date,
  reactivatedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
assignmentSchema.index({ vendorId: 1, tenantId: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } });
assignmentSchema.index({ tenantId: 1, status: 1 });

export const identityModels = {
  User: model('User', userSchema),
  Role: model('Role', roleSchema),
  Permission: model('Permission', permissionSchema),
  UserRole: model('UserRole', userRoleSchema),
  Tenant: model('Tenant', tenantSchema),
  BusinessProfile: model('BusinessProfile', businessProfileSchema),
  Vendor: model('Vendor', vendorSchema),
  VendorClientAssignment: model('VendorClientAssignment', assignmentSchema),
};