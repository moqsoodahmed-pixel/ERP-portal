import { z } from 'zod';
import { moneySchema } from './common.js';
import { ALLOWED_BILL_MIME_TYPES, MAX_BILL_FILE_BYTES } from './billIntake.validators.js';

/** Protects the backend against an unreasonably large payload; the UI has no hardcoded product limit below this. */
export const MAX_BILL_ITEMS = 200;

export const gstBillItemInput = z.object({
  productName: z.string().trim().min(1, 'Product name is required').max(200),
  rate: moneySchema.refine((v) => Number(v) > 0, 'Rate must be greater than 0'),
}).strict();

/** Only the line items are ever trusted from the client — subtotal/gstAmount/grandTotal are always server-computed. */
export const gstBillSave = z.object({
  items: z.array(gstBillItemInput).min(1, 'Please add at least one product').max(MAX_BILL_ITEMS),
}).strict();

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const fileInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(ALLOWED_BILL_MIME_TYPES),
  contentBase64: z.string().min(1).max(Math.ceil((MAX_BILL_FILE_BYTES * 4) / 3) + 1024).regex(BASE64_RE, 'Invalid base64 content'),
}).strict();

export const gstBillDocumentsUpload = z.object({
  documents: z.array(fileInput).min(1).max(10),
}).strict();

/** Phase 21 — vendor final-document upload. Same file-shape/size/type rules as the client's own bill
 * upload above (reuses ALLOWED_BILL_MIME_TYPES/MAX_BILL_FILE_BYTES) — no separate upload limits invented. */
export const gstFinalDocumentUpload = z.object({
  documents: z.array(fileInput).min(1).max(10),
}).strict();
