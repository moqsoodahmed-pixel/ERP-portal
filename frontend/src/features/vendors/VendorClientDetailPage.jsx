import React from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format.js';
import { useFetch } from './vendorsApi.js';

export default function VendorClientDetailPage() {
  const { tenantId } = useParams();
  const { status, data, error, reload } = useFetch(`/vendors/me/clients/${tenantId}/invoices`);
  const billsReq = useFetch(`/bills?client=${tenantId}&limit=10&sort=-updatedAt`);
  const tallyReq = useFetch(`/tally/queue?clientId=${tenantId}&limit=10`);
  const filingsReq = useFetch(`/gst-filings?client=${tenantId}&limit=10&sort=-periodKey`);

  return (
    <>
      <PageHeader title="Client workspace" subtitle="Read-only. Access is re-checked against your active assignment on every request." />

      <Card style={{ marginBottom: '1.25rem' }} aria-label="Bills">
        <CardHeader title="Bills (accounting workflow)" />
        <CardBody>
          {billsReq.status === 'loading' && <LoadingState />}
          {billsReq.status === 'error' && <ErrorState error={billsReq.error} onRetry={billsReq.reload} />}
          {billsReq.status === 'ready' && billsReq.data.items.length === 0 && <EmptyState title="No bills yet" />}
          {billsReq.status === 'ready' && billsReq.data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Bill #</th><th>Status</th><th>Tally status</th><th>Updated</th></tr></thead>
                <tbody>
                  {billsReq.data.items.map((b) => (
                    <tr key={b._id}>
                      <td><Link to={`/vendor/bills/${b._id}`}><strong>{b.billNumber ?? '(no number yet)'}</strong></Link></td>
                      <td><StatusBadge status={b.status} /></td>
                      <td><StatusBadge status={b.tallyStatus} /></td>
                      <td>{formatDateTime(b.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: '12px', marginTop: '0.75rem' }}>Bill statuses are this ERP&apos;s own internal workflow tracker, not a Tally or government confirmation.</p>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }} aria-label="Tally queue">
        <CardHeader title="Tally queue" />
        <CardBody>
          {tallyReq.status === 'loading' && <LoadingState />}
          {tallyReq.status === 'error' && <ErrorState error={tallyReq.error} onRetry={tallyReq.reload} />}
          {tallyReq.status === 'ready' && tallyReq.data.items.length === 0 && <EmptyState title="Nothing queued" />}
          {tallyReq.status === 'ready' && tallyReq.data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Bill #</th><th>Tally status</th><th>Last attempt</th></tr></thead>
                <tbody>
                  {tallyReq.data.items.map((b) => (
                    <tr key={b.id}>
                      <td><Link to={`/vendor/bills/${b.id}`}><strong>{b.billNumber ?? '(no number yet)'}</strong></Link></td>
                      <td><StatusBadge status={b.tallyStatus} /></td>
                      <td>{b.lastSyncAttemptAt ? formatDateTime(b.lastSyncAttemptAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: '12px', marginTop: '0.75rem' }}>&quot;SYNCED&quot; reflects the connector&apos;s own reported result — awaiting Tally validation, never a confirmed real-world TallyPrime entry in this environment.</p>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }} aria-label="GST filings">
        <CardHeader title="GST filing workflow" />
        <CardBody>
          {filingsReq.status === 'loading' && <LoadingState />}
          {filingsReq.status === 'error' && <ErrorState error={filingsReq.error} onRetry={filingsReq.reload} />}
          {filingsReq.status === 'ready' && filingsReq.data.items.length === 0 && <EmptyState title="No filings yet" />}
          {filingsReq.status === 'ready' && filingsReq.data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Period</th><th>Return type</th><th>Status</th><th>Progress</th></tr></thead>
                <tbody>
                  {filingsReq.data.items.map((f) => (
                    <tr key={f._id}>
                      <td>{f.periodKey}</td>
                      <td>{f.returnType?.replace('_', ' ')}</td>
                      <td><Link to={`/vendor/filings/${f._id}`}><StatusBadge status={f.status} /></Link></td>
                      <td>{f.progressPercent ?? 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: '12px', marginTop: '0.75rem' }}>Internal workflow state only — there is no real GSTN/government filing integration in this platform.</p>
        </CardBody>
      </Card>

      <Card aria-label="Invoices">
        <CardHeader title="Invoices" />
        <CardBody>
          {status === 'loading' && <LoadingState />}
          {status === 'error' && <ErrorState error={error} onRetry={reload} />}
          {status === 'ready' && data.items.length === 0 && <EmptyState title="No invoices yet" />}
          {status === 'ready' && data.items.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
                <tbody>
                  {data.items.map((inv) => (
                    <tr key={inv._id}>
                      <td><Link to={`/vendor/invoices/${inv._id}`} className="mono"><strong>{inv.invoiceNumber}</strong></Link></td>
                      <td>{formatDate(inv.invoiceDate)}</td>
                      <td><StatusBadge status={inv.invoiceStatus} /></td>
                      <td><StatusBadge status={inv.paymentStatus} /></td>
                      <td><strong>{formatMoney(inv.grandTotal)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
