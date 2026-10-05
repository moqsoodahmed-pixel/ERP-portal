import StatusBadge from '../../components/StatusBadge.jsx';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format.js';

const money = (key, header) => ({ key, header, numeric: true, render: (r) => formatMoney(r[key]) });
const status = (key, header) => ({ key, header, render: (r) => <StatusBadge status={r[key]} /> });
const date = (key, header) => ({ key, header, render: (r) => formatDate(r[key]) });
const dateTime = (key, header) => ({ key, header, render: (r) => formatDateTime(r[key]) });

/** Display columns per report type. Values are pre-computed server-side; the browser only formats them. */
export const REPORT_COLUMNS = {
  'invoice-summary': [
    { key: 'invoiceNumber', header: 'Invoice', mono: true }, date('invoiceDate', 'Date'), { key: 'customerName', header: 'Customer' }, status('invoiceStatus', 'Status'),
    money('taxableAmount', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('grandTotal', 'Grand total'), status('tallySyncStatus', 'Tally'),
  ],
  'gst-summary': [
    { key: 'period', header: 'Period', mono: true }, { key: 'invoiceCount', header: 'Invoices', numeric: true }, { key: 'gstApplicableInvoiceCount', header: 'GST-applicable', numeric: true },
    money('taxableAmount', 'Taxable'), money('cgst', 'CGST'), money('sgst', 'SGST'), money('igst', 'IGST'), money('totalGst', 'Total GST'),
  ],
  'tally-sync': [
    { key: 'invoiceNumber', header: 'Invoice', mono: true }, status('status', 'Status'), { key: 'attempt', header: 'Attempt', numeric: true },
    { key: 'voucherNumber', header: 'Voucher' }, { key: 'errorCode', header: 'Error code', mono: true }, { key: 'errorMessage', header: 'Error' }, dateTime('startedAt', 'Started'),
  ],
  'gst-filing-status': [
    { key: 'clientName', header: 'Client' }, { key: 'periodKey', header: 'Period', mono: true }, { key: 'returnType', header: 'Return' }, status('status', 'Status'),
    { key: 'progressPercent', header: 'Progress', render: (r) => `${r.progressPercent}%` }, { key: 'assignedVendor', header: 'Vendor' }, { key: 'openIssues', header: 'Open issues', numeric: true },
    { key: 'readiness', header: 'Workflow readiness (internal)', render: (r) => (r.readiness.ready ? 'Ready' : r.readiness.blockers.join('; ')) },
    { key: 'ack', header: 'Ack. no. (manually recorded)', render: (r) => r.submissionInfo.acknowledgementNumber ?? '—' },
  ],
  'gst-filing-issues': [
    { key: 'clientName', header: 'Client' }, { key: 'type', header: 'Type' }, status('severity', 'Severity'), status('status', 'Status'), { key: 'title', header: 'Title' },
    { key: 'filingPeriod', header: 'Filing', mono: true }, { key: 'invoiceNumber', header: 'Invoice', mono: true }, { key: 'assignedVendor', header: 'Vendor' },
    date('createdAt', 'Created'), date('resolvedAt', 'Resolved'),
  ],
  'customer-summary': [
    { key: 'customerCode', header: 'Code', mono: true }, { key: 'name', header: 'Name' }, { key: 'gstin', header: 'GSTIN', mono: true }, status('status', 'Status'),
    { key: 'issuedInvoiceCount', header: 'Issued invoices', numeric: true }, money('issuedGrandTotal', 'Issued total'), date('createdAt', 'Created'),
  ],
};

export const STATUS_OPTIONS = {
  'invoice-summary': ['DRAFT', 'ISSUED', 'CANCELLED'],
  'tally-sync': ['NOT_SYNCED', 'SYNCING', 'SYNCED', 'FAILED', 'RETRYING'],
  'gst-filing-status': ['NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'SUBMITTED', 'FILED'],
  'gst-filing-issues': ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  'customer-summary': ['ACTIVE', 'INACTIVE', 'ARCHIVED'],
};

const MONEY_KEYS = new Set(['taxableAmount', 'cgst', 'sgst', 'igst', 'totalTax', 'totalGst', 'grandTotal']);
const humanize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/** Generic, read-only rendering of a server-computed summary object (totals, status counts, notes). */
export function SummaryView({ summary }) {
  if (!summary) return null;
  const blocks = Object.entries(summary).filter(([k, v]) => k !== 'note' && v && typeof v === 'object' && !Array.isArray(v));
  return (
    <div>
      {blocks.map(([name, obj]) => (
        <dl key={name} className="summary-grid" aria-label={humanize(name)}>
          {Object.entries(obj).map(([k, v]) => (
            <div key={k}><dt>{humanize(name)} · {k.includes('_') || k === k.toUpperCase() ? k.replaceAll('_', ' ').toLowerCase() : humanize(k)}</dt><dd>{MONEY_KEYS.has(k) ? formatMoney(v) : String(v)}</dd></div>
          ))}
        </dl>
      ))}
      {Array.isArray(summary.failureReasons) && summary.failureReasons.length > 0 && (
        <p className="muted">Failure reasons: {summary.failureReasons.map((r) => `${r.errorCode} (${r.count})`).join(', ')}</p>
      )}
      {summary.latestSuccessfulSyncAt !== undefined && <p className="muted">Latest successful sync: {formatDateTime(summary.latestSuccessfulSyncAt)}</p>}
      {summary.note && <p className="muted">{summary.note}</p>}
    </div>
  );
}
