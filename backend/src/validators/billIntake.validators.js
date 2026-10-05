import { z } from 'zod';
import {
  objectIdSchema, listQuery, moneySchema, gstinSchema,
} from './common.js';
import { BILL_TALLY_STATUS } from '../constants/statuses.js';

/**
 * Phase 15 — Bill Intake. Every money/date/identifying field is OPTIONAL at create/draft-update time (spec
 * Step 3: never fake/default a value the client hasn't actually provided yet); the review/Tally-readiness
 * workflow is what later decides whether a bill has "enough" data, not the input schema.
 */
export const billCreate = z.object({
  billNumber: z.string().trim().min(1).max(100).optional(),
  billDate: z.coerce.date().optional(),
  vendorName: z.string().trim().min(1).max(200).optional(),
  vendorGSTIN: gstinSchema.optional(),
  amount: moneySchema.optional(),
  taxableAmount: moneySchema.optional(),
  cgst: moneySchema.optional(),
  sgst: moneySchema.optional(),
  igst: moneySchema.optional(),
  notes: z.string().max(2000).optional(),
}).strict();

/** Draft-editable fields only (spec Step 4/11) — status/tallyStatus/reviewedBy/etc are never client-settable here. */
export const billUpdate = billCreate.partial().strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const billSubmit = z.object({
  note: z.string().max(1000).optional(),
}).strict().optional();

export const billReject = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();

export const billReview = z.object({
  note: z.string().max(1000).optional(),
}).strict().optional();

export const billListQuery = listQuery.extend({
  status: z.string().max(40).optional(),
  tallyStatus: z.enum(Object.values(BILL_TALLY_STATUS)).optional(),
  client: objectIdSchema.optional(),
});

export const tallyQueueQuery = listQuery.extend({
  tallyStatus: z.enum(Object.values(BILL_TALLY_STATUS)).optional(),
  clientId: objectIdSchema.optional(),
});

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const ALLOWED_MIME = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
];
/** 5MB per file, base64-encoded in JSON (no multipart upload stack exists in this backend yet — see docs/bill-intake-workflow.md). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const fileInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_MIME),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 1024).regex(BASE64_RE, 'Invalid base64 content'),
}).strict();

export const billDocumentsUpload = z.object({
  documents: z.array(fileInput).min(1).max(10),
}).strict();

export const MAX_BILL_FILE_BYTES = MAX_FILE_BYTES;
export const ALLOWED_BILL_MIME_TYPES = ALLOWED_MIME;

export const billTallySynced = z.object({
  tallyReference: z.string().trim().min(1).max(200),
}).strict();

export const billTallyFailed = z.object({
  reason: z.string().trim().min(3).max(1000),
}).strict();
