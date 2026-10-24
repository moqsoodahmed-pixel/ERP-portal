import React, { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, adminTenantHeaders } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  DefinitionList,
  DefinitionItem,
  Button,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, readFileAsBase64 } from './billsApi.js';

const DRAFT_FIELDS = ['billNumber', 'billDate', 'vendorName', 'vendorGSTIN', 'amount', 'taxableAmount', 'cgst', 'sgst', 'igst', 'notes'];

function BillForm({ bill, onSave }) {
  const [form, setForm] = useState(Object.fromEntries(DRAFT_FIELDS.map((k) => [k, bill[k] ? String(bill[k]).slice(0, 10 === k.length ? 10 : 200) : ''])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const patch = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''));
      await onSave(patch);
    } catch (err) { setError(err.message ?? 'Could not save'); } finally { setBusy(false); }
  };
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <form onSubmit={save}>
        <CardHeader title="Bill details" />
        <CardBody>
          {error && <p className="state state--error" role="alert">{error}</p>}
          <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <label className="field"><span>Bill number</span><input className="input" value={form.billNumber} onChange={set('billNumber')} maxLength={100} /></label>
            <label className="field"><span>Bill date</span><input className="input" type="date" value={form.billDate ? String(form.billDate).slice(0, 10) : ''} onChange={set('billDate')} /></label>
            <label className="field"><span>Vendor name</span><input className="input" value={form.vendorName} onChange={set('vendorName')} maxLength={200} /></label>
            <label className="field"><span>Vendor GSTIN</span><input className="input" value={form.vendorGSTIN} onChange={set('vendorGSTIN')} maxLength={15} /></label>
            <label className="field"><span>Amount</span><input className="input" value={form.amount} onChange={set('amount')} /></label>
            <label className="field"><span>Taxable amount</span><input className="input" value={form.taxableAmount} onChange={set('taxableAmount')} /></label>
            <label className="field"><span>CGST</span><input className="input" value={form.cgst} onChange={set('cgst')} /></label>
            <label className="field"><span>SGST</span><input className="input" value={form.sgst} onChange={set('sgst')} /></label>
            <label className="field"><span>IGST</span><input className="input" value={form.igst} onChange={set('igst')} /></label>
          </div>
          <label className="field" style={{ marginBottom: '1.25rem' }}><span>Notes</span><textarea className="textarea" rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} /></label>
          <Button type="submit" variant="primary" disabled={busy}>Save draft</Button>
        </CardBody>
      </form>
    </Card>
  );
}

function DocumentsPanel({ bill, canUpload, canView, onUploaded, reqOpts }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const upload = async (e) => {
    const files = [...(e.target.files ?? [])];
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const documents = await Promise.all(files.map(async (f) => ({ fileName: f.name, mimeType: f.type, contentBase64: await readFileAsBase64(f) })));
      await api.post(`/bills/${bill._id}/documents`, { documents }, reqOpts);
      await onUploaded();
    } catch (err) { setError(err.message ?? 'Upload failed'); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };
  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <CardHeader title="Documents" />
      <CardBody>
        {error && <p className="state state--error" role="alert">{error}</p>}
        {(!bill.documents || bill.documents.length === 0) && <EmptyState title="No documents uploaded yet" />}
        {bill.documents?.length > 0 && (
          <ul className="link-list" style={{ marginBottom: '1rem' }}>
            {bill.documents.map((d) => (
              <li key={d.id}>
                {canView ? <a href={`/api/v1/bills/${bill._id}/documents/${d.id}`} target="_blank" rel="noreferrer">{d.fileName}</a> : d.fileName}
                {' '}<span className="muted">({Math.round((d.size ?? 0) / 1024)} KB, {formatDateTime(d.uploadedAt)})</span>
              </li>
            ))}
          </ul>
        )}
        {canUpload && bill.status === 'DRAFT' && (
          <label className="field">
            <span>Upload bill / supporting document (PDF, JPEG, PNG, WEBP — max 5MB each)</span>
            <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={upload} />
          </label>
        )}
      </CardBody>
    </Card>
  );
}

export default function BillDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const adminTenantId = searchParams.get('tenantId');
  const reqOpts = adminTenantId ? adminTenantHeaders(adminTenantId) : undefined;
  const { status, data: bill, error, reload } = useFetch(`/bills/${id}`, [adminTenantId], reqOpts);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [tallyReference, setTallyReference] = useState('');
  const [failureReason, setFailureReason] = useState('');

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState error={error} onRetry={reload} />;

  const canUpdate = can(user, 'bills.update');
  const canSubmit = can(user, 'bills.submit');
  const canReview = can(user, 'bills.review');
  const canReject = can(user, 'bills.reject');
  const canUpload = can(user, 'bills.documents.upload');
  const canViewDocs = can(user, 'bills.documents.view');
  const canTallyManage = can(user, 'bills.tally_manage');

  const run = async (fn, successMsg) => {
    setBusy(true); setNotice(null);
    try { await fn(); await reload(); setNotice(successMsg); } catch (err) { setNotice(err.message ?? 'Action failed'); } finally { setBusy(false); }
  };

  const isPlatform = user?.role === 'MASTER_ADMIN' || user?.role === 'MASTER_ASSISTANT_ADMIN';

  return (
    <>
      <PageHeader
        title={bill.billId ? `${bill.billId}${bill.billNumber ? ` (${bill.billNumber})` : ''}` : (bill.billNumber ?? `Bill ${bill._id}`)}
        subtitle="Client bill intake — not an official ERP invoice until explicitly converted through a controlled workflow."
        actions={<><StatusBadge status={bill.status} /> {isPlatform && <StatusBadge status={bill.tallyStatus} />}</>}
      />
      {notice && <p className="state" role="status">{notice}</p>}

      {isPlatform && bill.status === 'FAILED' && bill.tallyReadinessIssues?.length > 0 && (
        <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--bad)' }}>
          <CardHeader title="Why this bill can't proceed to Tally yet" />
          <CardBody>
            <ul className="link-list">{bill.tallyReadinessIssues.map((i) => <li key={i}>{i}</li>)}</ul>
          </CardBody>
        </Card>
      )}
      {bill.status === 'REJECTED' && bill.rejectionReason && (
        <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--bad)' }}>
          <CardHeader title="Rejection reason" />
          <CardBody><p>{bill.rejectionReason}</p></CardBody>
        </Card>
      )}
      {isPlatform && bill.tallyFailureReason && (
        <Card style={{ marginBottom: '1.25rem', borderColor: 'var(--bad)' }}>
          <CardHeader title="Tally failure reason" />
          <CardBody><p>{bill.tallyFailureReason}</p></CardBody>
        </Card>
      )}

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Workflow actions" />
        <CardBody>
          <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
            {bill.status === 'DRAFT' && canSubmit && (
              <Button variant="primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/submit`, undefined, reqOpts), 'Bill submitted for review')}>
                Submit bill
              </Button>
            )}
            {['SUBMITTED', 'UNDER_REVIEW'].includes(bill.status) && canReview && (
              <Button variant="primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/review`, undefined, reqOpts), 'Bill reviewed')}>
                Accept / move to Tally
              </Button>
            )}
            {['SUBMITTED', 'UNDER_REVIEW'].includes(bill.status) && canReject && (
              <span className="toolbar" style={{ gap: '0.5rem' }}>
                <input className="input" placeholder="Rejection reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <Button variant="danger" disabled={busy || !rejectReason.trim()} onClick={() => run(() => api.post(`/bills/${id}/reject`, { reason: rejectReason }, reqOpts), 'Bill rejected')}>
                  Reject
                </Button>
              </span>
            )}
            {isPlatform && bill.tallyStatus === 'QUEUED' && canTallyManage && (
              <Button disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/tally/processing`, undefined, reqOpts), 'Marked as processing in Tally')}>
                Start Tally processing
              </Button>
            )}
            {isPlatform && bill.tallyStatus === 'PROCESSING' && canTallyManage && (
              <span className="toolbar" style={{ gap: '0.5rem' }}>
                <input className="input" placeholder="Tally voucher reference" value={tallyReference} onChange={(e) => setTallyReference(e.target.value)} />
                <Button variant="primary" disabled={busy || !tallyReference.trim()} onClick={() => run(() => api.post(`/bills/${id}/tally/synced`, { tallyReference }, reqOpts), 'Marked synced to Tally')}>
                  Mark synced
                </Button>
                <input className="input" placeholder="Failure reason" value={failureReason} onChange={(e) => setFailureReason(e.target.value)} />
                <Button variant="danger" disabled={busy || !failureReason.trim()} onClick={() => run(() => api.post(`/bills/${id}/tally/failed`, { reason: failureReason }, reqOpts), 'Tally failure recorded')}>
                  Mark failed
                </Button>
              </span>
            )}
            {isPlatform && bill.tallyStatus === 'FAILED' && canTallyManage && (
              <Button disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/tally/retry`, undefined, reqOpts), 'Re-queued for Tally')}>
                Retry
              </Button>
            )}
            {bill.status === 'ACCOUNTING_IN_PROGRESS' && canTallyManage && (
              <Button variant="primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/complete`, undefined, reqOpts), 'Bill marked completed')}>
                Mark completed
              </Button>
            )}
            {!['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCOUNTING_IN_PROGRESS'].includes(bill.status) && (!isPlatform || (bill.tallyStatus !== 'QUEUED' && bill.tallyStatus !== 'PROCESSING' && bill.tallyStatus !== 'FAILED')) && (
              <p className="muted">No action available for the current status.</p>
            )}
          </div>
        </CardBody>
      </Card>

      {bill.status === 'DRAFT' && canUpdate && <BillForm bill={bill} onSave={async (patch) => { await api.patch(`/bills/${id}`, patch, reqOpts); await reload(); }} />}
      {bill.status !== 'DRAFT' && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Bill details" />
          <CardBody>
            <DefinitionList>
              <DefinitionItem label="Bill ID" value={bill.billId ?? '—'} mono />
              {bill.companyCode && <DefinitionItem label="Company code" value={bill.companyCode} mono />}
              <DefinitionItem label="Bill number" value={bill.billNumber} mono />
              <DefinitionItem label="Bill date" value={bill.billDate ? formatDate(bill.billDate) : '—'} />
              <DefinitionItem label="Supplier" value={bill.vendorName} />
              <DefinitionItem label="Supplier GSTIN" value={bill.vendorGSTIN} mono />
              <DefinitionItem label="Amount" value={bill.amount} />
            </DefinitionList>
          </CardBody>
        </Card>
      )}

      <DocumentsPanel bill={bill} canUpload={canUpload} canView={canViewDocs} onUploaded={reload} reqOpts={reqOpts} />

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Status timeline" />
        <CardBody>
          {(!bill.history || bill.history.length === 0) && <EmptyState title="No status changes yet" />}
          {bill.history?.length > 0 && (
            <Table caption="Bill status history">
              <TableHead>
                <TableRow hover={false}>
                  <TableHeaderCell>From</TableHeaderCell>
                  <TableHeaderCell>To</TableHeaderCell>
                  <TableHeaderCell>When</TableHeaderCell>
                  <TableHeaderCell>Note</TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {bill.history.map((hst, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{hst.previousStatus ?? '—'}</TableCell>
                    <TableCell><StatusBadge status={hst.newStatus} /></TableCell>
                    <TableCell>{formatDateTime(hst.timestamp)}</TableCell>
                    <TableCell>{hst.note ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </>
  );
}
