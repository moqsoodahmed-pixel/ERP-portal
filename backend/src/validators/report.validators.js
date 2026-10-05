import { z } from 'zod';
import { PAGINATION } from '../constants/pagination.js';
import { RANGE_PRESETS } from '../utils/dateRange.js';
import { FILING_RETURN_TYPE, FILING_ISSUE_SEVERITY, FILING_ISSUE_TYPE } from '../constants/statuses.js';
import { objectIdSchema } from './common.js';

/** Dashboard date window. Bounds (from<=to, <= ~2 years) are validated in utils/dateRange.js. */
export const dashboardQuery = z.object({
  range: z.enum(RANGE_PRESETS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();

/**
 * Report query. STRICT: unknown parameters are rejected (400), so a stray `tenantId` can never reach a
 * report on routes where resolveTenant has not already rejected/stripped it.
 */
export const reportQuery = dashboardQuery.extend({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION.MAX_LIMIT).optional(),
  status: z.string().max(40).optional(),
  returnType: z.enum(Object.values(FILING_RETURN_TYPE)).optional(),
  severity: z.enum(Object.values(FILING_ISSUE_SEVERITY)).optional(),
  issueType: z.enum(Object.values(FILING_ISSUE_TYPE)).optional(),
}).strict();

/** Master-only cross-tenant reports may narrow to one client (a platform-level filter, not an authorization input). */
export const masterReportQuery = reportQuery.extend({ clientId: objectIdSchema.optional() }).strict();

export const reportTypeParams = z.object({ type: z.string().max(40).regex(/^[a-z-]+$/) });

export const notificationListQuery = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  unread: z.enum(['true', 'false']).optional(),
}).strict();
