import { z } from 'zod';
import { objectIdSchema } from '../../validators/common.js';

export const syncRequestBody = z.object({ invoiceIds: z.array(objectIdSchema).min(1).max(100) }).strict();

const ledgerName = z.string().trim().min(1).max(200);

/** POST /tally/config. A password is only sent (and only applied) when the admin types a new one. */
export const tallyConfigBody = z.object({
  enabled: z.boolean().optional(),
  connectionType: z.enum(['LOCAL_TALLY', 'REMOTE_TALLY']).optional(),
  baseUrl: z.string().trim().min(1).max(2048).optional(),
  companyName: z.string().trim().max(200).optional(),
  defaultVoucherType: z.string().trim().max(60).optional(),
  salesLedger: ledgerName.optional(),
  cgstLedger: ledgerName.optional(),
  sgstLedger: ledgerName.optional(),
  igstLedger: ledgerName.optional(),
  roundOffLedger: ledgerName.optional(),
  discountLedger: ledgerName.optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
  retryMaxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  authUsername: z.string().trim().max(200).optional(),
  authPassword: z.string().min(1).max(500).optional(),
}).strict();

export const invoiceIdParams = z.object({ id: objectIdSchema });
