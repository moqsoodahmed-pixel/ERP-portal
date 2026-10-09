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

export const businessProfileCreate = z.object({
  displayName: z.string().trim().min(1).max(200),
  gstin: gstinSchema.optional(),
  address: addressInput.optional(),
  mobile: z.string().trim().max(20).optional(),
  email: emailSchema.optional(),
  website: z.string().trim().url().max(200).optional(),
  offerings: z.array(z.enum(['PRODUCT', 'SERVICE'])).min(1).max(2).optional(),
}).strict();
export const businessProfileUpdate = businessProfileCreate.partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

const LOGO_BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED_LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
/** 2MB per logo, base64-encoded in JSON — same no-multipart-stack constraint as billIntake.validators.js. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_LOGO_FILE_BYTES = MAX_LOGO_BYTES;
export const ALLOWED_LOGO_MIME_TYPES = ALLOWED_LOGO_MIME;
export const businessProfileLogoUpload = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_LOGO_MIME),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 1024).regex(LOGO_BASE64_RE, 'Invalid base64 content'),
}).strict();

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
  }).strict()).min(1).max(200),
}).strict();
/** Same shape: a DRAFT edit is a full re-submission of customer/items, recomputed server-side — never a client-sent delta of totals. */
export const invoiceUpdate = invoiceCreate;
export const invoiceCancel = z.object({
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