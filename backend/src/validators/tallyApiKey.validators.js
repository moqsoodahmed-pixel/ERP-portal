import { z } from 'zod';
import { TALLY_API_SCOPES } from '../integrations/tally/tally.constants.js';

export const tallyApiKeyCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(TALLY_API_SCOPES)).max(TALLY_API_SCOPES.length).default([]),
  expiresAt: z.coerce.date().optional(),
}).strict();
