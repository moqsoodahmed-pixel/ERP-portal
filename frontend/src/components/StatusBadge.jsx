import React from 'react';
import { Badge } from '../design-system/index.js';

const TONES = {
  ACTIVE: 'ok', PAID: 'ok', SYNCED: 'ok', FILED: 'ok', ACKNOWLEDGED: 'ok', RESOLVED: 'ok', ISSUED: 'ok', GRANTED: 'ok',
  PENDING: 'warn', DRAFT: 'warn', UNPAID: 'warn', NOT_SYNCED: 'neutral', QUEUED: 'info', SYNCING: 'info', RETRYING: 'warn',
  ASSIGNED: 'info', UNDER_REVIEW: 'info', DATA_PREPARATION: 'info', READY_FOR_FILING: 'info', PARTIALLY_PAID: 'warn',
  SUSPENDED: 'bad', FAILED: 'bad', ISSUE_RAISED: 'bad', CANCELLED: 'bad', DISABLED: 'bad', INACTIVE: 'neutral', ARCHIVED: 'neutral',
  REVOKED: 'bad', EXPIRED: 'bad',
  // Phase 8: GST filing workflow tracker + issue tracker statuses (independent state machines).
  NOT_STARTED: 'neutral', IN_PROGRESS: 'info', READY_FOR_REVIEW: 'warn', SUBMITTED: 'info',
  OPEN: 'bad', CLOSED: 'neutral',
  LOW: 'neutral', MEDIUM: 'warn', HIGH: 'bad', CRITICAL: 'bad',
  // Phase 20: GST Bill <-> Tally matching (per-bill + overall statuses).
  MATCHED: 'ok', FULLY_MATCHED: 'ok', MISMATCH: 'bad', NOT_FOUND: 'warn', DUPLICATE: 'warn',
  PARTIAL_MATCH: 'warn', NOT_MATCHED: 'bad', TALLY_ERROR: 'bad', ERROR: 'bad',
};

const label = (s) => String(s).replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Status is conveyed by readable text as well as semantic colour. */
export default function StatusBadge({ status }) {
  if (!status) return <span className="muted">—</span>;
  const tone = TONES[status] ?? 'neutral';
  return <Badge tone={tone}>{label(status)}</Badge>;
}
