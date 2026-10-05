import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12, 'Password must be at least 12 characters').max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Password needs upper, lower case letters and a digit');
export const moneySchema = z.union([z.string(), z.number()]).transform(String)
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with up to 2 decimals');
export const quantitySchema = z.union([z.string(), z.number()]).transform(String)
  .refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v) && Number(v) > 0, 'Must be a positive quantity with up to 3 decimals');
export const gstinSchema = z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN');
export const panSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Invalid PAN');
export const pincodeSchema = z.string().regex(/^\d{6}$/, 'Invalid pincode');
export const addressInput = z.object({
  line1: z.string().max(200).optional(), line2: z.string().max(200).optional(), city: z.string().max(100).optional(),
  state: z.string().max(100).optional(), stateCode: z.string().max(2).optional(), pincode: pincodeSchema.optional(),
  country: z.string().length(2).optional(),
}).strict();

export const idParams = z.object({ id: objectIdSchema });

/** Shared list contract: pagination + search + status + date range + sort. Unknown params are ignored, not trusted. */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).optional(),
  search: z.string().max(PAGINATION.MAX_SEARCH_LENGTH).optional(),
  status: z.string().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().max(80).optional(),
}).passthrough();
