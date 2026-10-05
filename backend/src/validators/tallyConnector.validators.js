import { z } from 'zod';

export const tallyConnectorRegisterBody = z.object({
  name: z.string().trim().min(1).max(120),
}).strict();

export const tallyConnectorHeartbeatBody = z.object({
  version: z.string().trim().max(40).optional(),
  tallyAvailable: z.boolean().optional(),
  companyName: z.string().trim().max(200).optional(),
  companyGuid: z.string().trim().max(200).optional(),
}).strict();

/** Mass-assignment guard (spec Step 22): only these exact fields are ever accepted from a result report —
 * no status other than SUCCEEDED/FAILED, no arbitrary job fields. */
export const tallyJobResultBody = z.object({
  status: z.enum(['SUCCEEDED', 'FAILED']),
  tallyReference: z.string().trim().max(200).optional(),
  errorCode: z.string().trim().max(60).optional(),
  message: z.string().trim().max(1000).optional(),
  requestId: z.string().trim().max(80).optional(),
}).strict();

export const tallyJobQueueQuery = z.object({
  status: z.enum(['QUEUED', 'CLAIMED', 'PROCESSING', 'SUCCEEDED', 'FAILED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
