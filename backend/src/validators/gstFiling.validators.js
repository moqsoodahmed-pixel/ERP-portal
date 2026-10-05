import { z } from 'zod';
import { objectIdSchema, listQuery } from './common.js';
import { FILING_RETURN_TYPE, FILING_MILESTONE_STATUS, FILING_ISSUE_TYPE, FILING_ISSUE_SEVERITY, FILING_ISSUE_STATUS } from '../constants/statuses.js';

export const periodKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodKey must be YYYY-MM');

export const filingCreate = z.object({
  tenantId: objectIdSchema,
  periodKey: periodKeySchema,
  returnType: z.enum(Object.values(FILING_RETURN_TYPE)),
  vendorUserId: objectIdSchema.optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().max(2000).optional(),
}).strict();

export const filingListQuery = listQuery.extend({
  period: periodKeySchema.optional(),
  returnType: z.enum(Object.values(FILING_RETURN_TYPE)).optional(),
  status: z.string().max(40).optional(),
  vendor: objectIdSchema.optional(),
  client: objectIdSchema.optional(),
});

const milestoneInput = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  status: z.enum(Object.values(FILING_MILESTONE_STATUS)),
  order: z.number().int().min(1).max(50),
}).strict();

export const filingUpdate = z.object({
  notes: z.string().max(2000).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  vendorUserId: objectIdSchema.nullable().optional(),
  milestones: z.array(milestoneInput).max(30).optional(),
  submissionInfo: z.object({
    acknowledgementNumber: z.string().max(100).optional(),
    referenceNumber: z.string().max(100).optional(),
    submittedAt: z.coerce.date().optional(),
    notes: z.string().max(2000).optional(),
  }).strict().partial().optional(),
}).strict().refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const issueCreate = z.object({
  invoiceId: objectIdSchema.optional(),
  type: z.enum(Object.values(FILING_ISSUE_TYPE)),
  severity: z.enum(Object.values(FILING_ISSUE_SEVERITY)).optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  assignedTo: objectIdSchema.optional(),
}).strict();

export const issueUpdate = z.object({
  type: z.enum(Object.values(FILING_ISSUE_TYPE)).optional(),
  severity: z.enum(Object.values(FILING_ISSUE_SEVERITY)).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(Object.values(FILING_ISSUE_STATUS)).optional(),
  assignedTo: objectIdSchema.nullable().optional(),
  resolution: z.string().trim().max(2000).optional(),
}).strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required')
  .refine((v) => v.status !== 'RESOLVED' || Boolean(v.resolution && v.resolution.trim()), { message: 'A resolution description is required to resolve an issue', path: ['resolution'] });
