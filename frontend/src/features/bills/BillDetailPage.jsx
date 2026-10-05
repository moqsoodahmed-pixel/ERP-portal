import { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api, adminTenantHeaders } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
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
    <form className="card" onSubmit={save}>
      <h2>Bill details</h2>
      {error && <p className="state state--error" role="alert">{error}</p>}
      <label className="field"><span>Bill number</span><input value={form.billNumber} onChange={set('billNumber')} maxLength={100} /></label>
      <label className="field"><span>Bill date</span><input type="date" value={form.billDate ? String(form.billDate).slice(0, 10) : ''} onChange={set('billDate')} /></label>
      <label className="field"><span>Vendor name</span><input value={form.vendorName} onChange={set('vendorName')} maxLength={200} /></label>
      <label className="field"><span>Vendor GSTIN</span><input value={form.vendorGSTIN} onChange={set('vendorGSTIN')} maxLength={15} /></label>
      <label className="field"><span>Amount</span><input value={form.amount} onChange={set('amount')} /></label>
      <label className="field"><span>Taxable amount</span><input value={form.taxableAmount} onChange={set('taxableAmount')} /></label>
      <label className="field"><span>CGST</span><input value={form.cgst} onChange={set('cgst')} /></label>
      <label className="field"><span>SGST</span><input value={form.sgst} onChange={set('sgst')} /></label>
      <label className="field"><span>IGST</span><input value={form.igst} onChange={set('igst')} /></label>
      <label className="field"><span>Notes</span><textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={2000} /></label>
      <button type="submit" className="btn btn--primary" disabled={busy}>Save draft</button>
    </form>
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
    <section className="card">
      <h2>Documents</h2>
      {error && <p className="state state--error" role="alert">{error}</p>}
      {(!bill.documents || bill.documents.length === 0) && <EmptyState title="No documents uploaded yet" />}
      {bill.documents?.length > 0 && (
        <ul className="link-list">
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
    </section>
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

  return (
    <>
      <PageHeader
        title={bill.billNumber ?? `Bill ${bill._id}`}
        subtitle="Client bill intake — not an official ERP invoice until explicitly converted through a controlled workflow."
        actions={<><StatusBadge status={bill.status} /> <StatusBadge status={bill.tallyStatus} /></>}
      />
      {notice && <p className="state" role="status">{notice}</p>}

      {bill.status === 'FAILED' && bill.tallyReadinessIssues?.length > 0 && (
        <section className="card">
          <h2>Why this bill can&apos;t proceed to Tally yet</h2>
          <ul className="link-list">{bill.tallyReadinessIssues.map((i) => <li key={i}>{i}</li>)}</ul>
        </section>
      )}
      {bill.status === 'REJECTED' && bill.rejectionReason && (
        <section className="card"><h2>Rejection reason</h2><p>{bill.rejectionReason}</p></section>
      )}
      {bill.tallyFailureReason && (
        <section className="card"><h2>Tally failure reason</h2><p>{bill.tallyFailureReason}</p></section>
      )}

      <section className="card">
        <h2>Workflow actions</h2>
        <div className="toolbar">
          {bill.status === 'DRAFT' && canSubmit && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/submit`, undefined, reqOpts), 'Bill submitted for review')}>Submit bill</button>
          )}
          {['SUBMITTED', 'UNDER_REVIEW'].includes(bill.status) && canReview && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/review`, undefined, reqOpts), 'Bill reviewed')}>Accept / move to Tally</button>
          )}
          {['SUBMITTED', 'UNDER_REVIEW'].includes(bill.status) && canReject && (
            <span className="toolbar">
              <input placeholder="Rejection reason (required)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <button type="button" className="btn btn--danger" disabled={busy || !rejectReason.trim()} onClick={() => run(() => api.post(`/bills/${id}/reject`, { reason: rejectReason }, reqOpts), 'Bill rejected')}>Reject</button>
            </span>
          )}
          {bill.tallyStatus === 'QUEUED' && canTallyManage && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/tally/processing`, undefined, reqOpts), 'Marked as processing in Tally')}>Start Tally processing</button>
          )}
          {bill.tallyStatus === 'PROCESSING' && canTallyManage && (
            <span className="toolbar">
              <input placeholder="Tally voucher reference" value={tallyReference} onChange={(e) => setTallyReference(e.target.value)} />
              <button type="button" className="btn btn--primary" disabled={busy || !tallyReference.trim()} onClick={() => run(() => api.post(`/bills/${id}/tally/synced`, { tallyReference }, reqOpts), 'Marked synced to Tally')}>Mark synced</button>
              <input placeholder="Failure reason" value={failureReason} onChange={(e) => setFailureReason(e.target.value)} />
              <button type="button" className="btn btn--danger" disabled={busy || !failureReason.trim()} onClick={() => run(() => api.post(`/bills/${id}/tally/failed`, { reason: failureReason }, reqOpts), 'Tally failure recorded')}>Mark failed</button>
            </span>
          )}
          {bill.tallyStatus === 'FAILED' && canTallyManage && (
            <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/tally/retry`, undefined, reqOpts), 'Re-queued for Tally')}>Retry</button>
          )}
          {bill.status === 'ACCOUNTING_IN_PROGRESS' && canTallyManage && (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => run(() => api.post(`/bills/${id}/complete`, undefined, reqOpts), 'Bill marked completed')}>Mark completed</button>
          )}
          {!['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'ACCOUNTING_IN_PROGRESS'].includes(bill.status) && bill.tallyStatus !== 'QUEUED' && bill.tallyStatus !== 'PROCESSING' && bill.tallyStatus !== 'FAILED' && (
            <p className="muted">No action available for the current status.</p>
          )}
        </div>
      </section>

      {bill.status === 'DRAFT' && canUpdate && <BillForm bill={bill} onSave={async (patch) => { await api.patch(`/bills/${id}`, patch, reqOpts); await reload(); }} />}
      {bill.status !== 'DRAFT' && (
        <section className="card">
          <h2>Bill details</h2>
          <dl className="definition-list">
            <div><dt>Bill number</dt><dd>{bill.billNumber ?? '—'}</dd></div>
            <div><dt>Bill date</dt><dd>{bill.billDate ? formatDate(bill.billDate) : '—'}</dd></div>
            <div><dt>Vendor</dt><dd>{bill.vendorName ?? '—'}</dd></div>
            <div><dt>Vendor GSTIN</dt><dd>{bill.vendorGSTIN ?? '—'}</dd></div>
            <div><dt>Amount</dt><dd>{bill.amount ?? '—'}</dd></div>
          </dl>
        </section>
      )}

      <DocumentsPanel bill={bill} canUpload={canUpload} canView={canViewDocs} onUploaded={reload} reqOpts={reqOpts} />

      <section className="card">
        <h2>Status timeline</h2>
        {(!bill.history || bill.history.length === 0) && <EmptyState title="No status changes yet" />}
        {bill.history?.length > 0 && (
          <table className="data-table">
            <thead><tr><th>From</th><th>To</th><th>When</th><th>Note</th></tr></thead>
            <tbody>
              {bill.history.map((hst, idx) => (
                <tr key={idx}><td>{hst.previousStatus ?? '—'}</td><td>{hst.newStatus}</td><td>{formatDateTime(hst.timestamp)}</td><td>{hst.note ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
