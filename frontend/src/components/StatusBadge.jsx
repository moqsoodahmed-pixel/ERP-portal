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
};
const label = (s) => String(s).replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Status is conveyed by text as well as colour. */
export default function StatusBadge({ status }) {
  if (!status) return <span className="muted">—</span>;
  return <span className={`badge badge--${TONES[status] ?? 'neutral'}`}>{label(status)}</span>;
}
