import { z } from 'zod';
import {
  addressInput, emailSchema, gstinSchema, listQuery, moneySchema, objectIdSchema, panSchema, passwordSchema, quantitySchema,
} from './common.js';
import { GRANTABLE_TO_TENANT_USERS } from '../constants/permissions.js';
import { TENANT_STATUS } from '../constants/statuses.js';

export const productCreate = z.object({
  type: z.enum(['PRODUCT', 'SERVICE']).optional(),
  productName: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  hsnSacCode: z.string().regex(/^\d{4,8}$/).optional(),
  unit: z.string().max(20).optional(),
  sellingPrice: moneySchema,
  purchasePrice: moneySchema.optional(),
  gstRate: z.number().min(0).max(100).optional(),
  isGstApplicable: z.boolean().optional(),
}).strict();
export const productUpdate = productCreate.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();

/** Phase 22 — letterhead text/bank fields, folded into the same PATCH /business-profile body. */
export const bankDetailsInput = z.object({
  accountName: z.string().trim().max(200).optional(),
  accountNumber: z.string().trim().max(40).optional(),
  ifsc: z.string().trim().max(20).optional(),
  bankName: z.string().trim().max(200).optional(),
  branch: z.string().trim().max(200).optional(),
}).strict();
export const letterheadDetailsFields = {
  bankDetails: bankDetailsInput.optional(),
  footerText: z.string().max(1000).optional(),
  defaultTermsAndConditions: z.string().max(2000).optional(),
  declaration: z.string().max(1000).optional(),
  authorizedSignatoryName: z.string().trim().max(120).optional(),
  authorizedSignatoryDesignation: z.string().trim().max(120).optional(),
};

export const businessProfileCreate = z.object({
  displayName: z.string().trim().min(1).max(200),
  gstin: gstinSchema.optional(),
  pan: panSchema.optional(),
  msme: z.string().trim().max(50).optional(),
  cin: z.string().trim().max(50).optional(),
  address: addressInput.optional(),
  mobile: z.string().trim().max(20).optional(),
  email: emailSchema.optional(),
  website: z.string().trim().url().max(200).optional(),
  offerings: z.array(z.enum(['PRODUCT', 'SERVICE'])).min(1).max(2).optional(),
}).strict();
/** Letterhead text/bank fields (Phase 22) are PATCH-only — set after the profile exists, never at creation. */
export const businessProfileUpdate = businessProfileCreate.partial().extend(letterheadDetailsFields).strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const letterheadTemplateCreate = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().optional(),
  margins: z.object({
    top: z.number().min(0).max(150).optional(),
    bottom: z.number().min(0).max(150).optional(),
    left: z.number().min(0).max(150).optional(),
    right: z.number().min(0).max(150).optional(),
  }).optional(),
  colors: z.object({
    primary: z.string().max(30).optional(),
    secondary: z.string().max(30).optional(),
    accent: z.string().max(30).optional(),
  }).optional(),
  typography: z.object({
    fontFamily: z.string().max(50).optional(),
    headingAlignment: z.enum(['left', 'center', 'right']).optional(),
  }).optional(),
  pan: panSchema.optional(),
  msme: z.string().trim().max(50).optional(),
  cin: z.string().trim().max(50).optional(),
  watermarkSettings: z.object({
    opacity: z.number().min(0.01).max(1).optional(),
    scale: z.number().min(50).max(600).optional(),
  }).optional(),
  logoFileId: objectIdSchema.nullable().optional(),
  backgroundFileId: objectIdSchema.nullable().optional(),
  watermarkFileId: objectIdSchema.nullable().optional(),
  signatureFileId: objectIdSchema.nullable().optional(),
  sealFileId: objectIdSchema.nullable().optional(),
  qrCodeFileId: objectIdSchema.nullable().optional(),
  bankDetails: bankDetailsInput.nullable().optional(),
  footerText: z.string().max(1000).nullable().optional(),
  declaration: z.string().max(1000).nullable().optional(),
  defaultTermsAndConditions: z.string().max(2000).nullable().optional(),
  authorizedSignatoryName: z.string().trim().max(120).nullable().optional(),
  authorizedSignatoryDesignation: z.string().trim().max(120).nullable().optional(),
  customSections: z.array(z.object({
    id: z.string().min(1).max(50),
    title: z.string().trim().min(1).max(100),
    content: z.string().max(2000),
    order: z.number().optional(),
    visible: z.boolean().optional(),
  })).optional(),
  historyNote: z.string().max(200).optional(),
}).strict();

export const letterheadTemplateUpdate = letterheadTemplateCreate.partial().strict();

const LOGO_BASE64_RE = /^[A-Za-z0-9+/=\s]+$/;
const ALLOWED_LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
/** 2MB per logo, base64-encoded in JSON — same no-multipart-stack constraint as billIntake.validators.js. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_FILE_BYTES = MAX_LOGO_BYTES;
export const ALLOWED_LOGO_MIME_TYPES = ALLOWED_LOGO_MIME;
export const businessProfileLogoUpload = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_LOGO_MIME),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 1024).regex(LOGO_BASE64_RE, 'Invalid base64 content'),
}).strict();

/**
 * Phase 22 — Letterhead assets (background/watermark/signature/seal/QR code). Same base64-in-JSON shape
 * and MIME allow-list as the logo upload above, but a letterhead background is a full-page image so it
 * gets a larger cap (8MB) than the other, typically-small assets (2MB, same as the logo).
 */
const MAX_LETTERHEAD_ASSET_BYTES = 8 * 1024 * 1024;
export const MAX_LETTERHEAD_ASSET_FILE_BYTES = MAX_LETTERHEAD_ASSET_BYTES;
const letterheadAssetUpload = (maxBytes) => z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_LOGO_MIME),
  contentBase64: z.string().min(1).max(Math.ceil((maxBytes * 4) / 3) + 1024).regex(LOGO_BASE64_RE, 'Invalid base64 content'),
}).strict();
export const businessProfileBackgroundUpload = letterheadAssetUpload(MAX_LETTERHEAD_ASSET_BYTES);
export const businessProfileWatermarkUpload = letterheadAssetUpload(MAX_LETTERHEAD_ASSET_BYTES);
export const businessProfileSignatureUpload = letterheadAssetUpload(MAX_LOGO_BYTES);
export const businessProfileSealUpload = letterheadAssetUpload(MAX_LOGO_BYTES);
export const businessProfileQrCodeUpload = letterheadAssetUpload(MAX_LOGO_BYTES);

export const customerCreate = z.object({
  name: z.string().trim().min(1).max(200),
  businessName: z.string().max(200).optional(),
  gstin: gstinSchema.optional(),
  pan: panSchema.optional(),
  phone: z.string().max(20).optional(),
  email: emailSchema.optional(),
  billingAddress: addressInput.optional(),
  shippingAddress: addressInput.optional(),
  state: z.string().max(100).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
}).strict();
export const customerUpdate = customerCreate.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }).strict();

export const invoiceCreate = z.object({
  customerId: objectIdSchema,
  invoiceDate: z.coerce.date(),
  dueDate: z.coerce.date().optional(),
  gstApplicable: z.boolean(),
  interState: z.boolean().optional(),
  placeOfSupplyStateCode: z.string().trim().max(10).optional(),
  notes: z.string().max(2000).optional(),
  termsAndConditions: z.string().max(2000).optional(),
  items: z.array(z.object({
    productId: objectIdSchema,
    description: z.string().max(500).optional(),
    quantity: quantitySchema,
    unitPrice: moneySchema.optional(),
    discount: moneySchema.optional(),
    gstRate: z.number().min(0).max(100).optional(),
    cessRate: z.number().min(0).max(100).optional(),
  }).strict()).min(1).max(200),
}).strict();
/** Same shape: a DRAFT edit is a full re-submission of customer/items, recomputed server-side — never a client-sent delta of totals. */
export const invoiceUpdate = invoiceCreate;
export const invoiceCancel = z.object({
  reason: z.string().trim().min(3).max(500),
}).strict();

/**
 * Phase 22 — Credit/Debit Notes. Deliberately the SAME item shape as invoiceCreate (productId + quantity +
 * optional unitPrice/discount/gstRate/cessRate overrides) — tax/total fields are never accepted from the
 * client here either; `.strict()` rejects them exactly like the invoice validators above. customerId and
 * gstApplicable/interState are never part of this body: they are always derived from the parent (ISSUED)
 * invoice server-side, never re-specified by the caller.
 */
export const creditDebitNoteCreate = z.object({
  noteDate: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
  items: z.array(z.object({
    productId: objectIdSchema,
    description: z.string().max(500).optional(),
    quantity: quantitySchema,
    unitPrice: moneySchema.optional(),
    discount: moneySchema.optional(),
    gstRate: z.number().min(0).max(100).optional(),
    cessRate: z.number().min(0).max(100).optional(),
  }).strict()).min(1).max(200),
}).strict();
export const creditDebitNoteCancel = z.object({
  reason: z.string().trim().min(3).max(500),
}).strict();

export const clientCreate = z.object({
  businessName: z.string().trim().min(1).max(200),
  legalName: z.string().max(200).optional(),
  gstin: gstinSchema.optional(),
  pan: panSchema.optional(),
  email: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  address: addressInput.optional(),
  admin: z.object({ name: z.string().trim().min(1).max(120), email: emailSchema, password: passwordSchema }).strict().optional(),
}).strict();
export const clientUpdate = clientCreate.omit({ admin: true }).partial().strict();
export const clientListQuery = listQuery.extend({ status: z.enum(Object.values(TENANT_STATUS)).optional() });
export const clientStatus = z.object({
  status: z.enum(Object.values(TENANT_STATUS)),
  reason: z.string().trim().min(5).max(500).optional(),
}).strict().refine(
  (v) => !['SUSPENDED', 'INACTIVE'].includes(v.status) || Boolean(v.reason),
  { message: 'A reason (minimum 5 characters) is required to suspend or deactivate a client', path: ['reason'] },
);

const phoneSchema = z.string().trim().regex(/^\+?[0-9][0-9\s-]{6,18}$/, 'Invalid phone number');

export const userCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: passwordSchema,
  role: z.enum(['CLIENT_ADMIN', 'CLIENT_USER']).default('CLIENT_USER'),
  grantedPermissions: z.array(z.enum(GRANTABLE_TO_TENANT_USERS)).max(60).optional(),
}).strict();

export const userUpdate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: phoneSchema.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  grantedPermissions: z.array(z.enum(GRANTABLE_TO_TENANT_USERS)).max(60).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const vendorCreate = z.object({
  name: z.string().trim().min(1).max(200),
  contactEmail: emailSchema,
  phone: z.string().max(20).optional(),
  user: z.object({ name: z.string().trim().min(1).max(120), email: emailSchema, password: passwordSchema }).strict(),
}).strict();
export const assignmentCreate = z.object({ tenantId: objectIdSchema }).strict();
export const vendorUpdate = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  contactEmail: emailSchema.optional(),
  phone: z.string().max(20).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  userStatus: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export const assignmentLifecycle = z.object({
  action: z.enum(['deactivate', 'reactivate']),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine((v) => v.action !== 'deactivate' || !!v.reason, 'reason is required to deactivate an assignment');