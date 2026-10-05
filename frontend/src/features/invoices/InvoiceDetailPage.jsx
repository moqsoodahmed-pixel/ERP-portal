import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { formatDate, formatMoney } from '../../utils/format.js';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', invoice: null, error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState(null);
  const [tallySync, setTallySync] = useState(null);
  const [tallyBusy, setTallyBusy] = useState(false);

  const fetchInvoice = () => api.get(`/invoices/${id}`)
    .then(({ data }) => setState({ status: 'ready', invoice: data, error: null }))
    .catch((error) => setState({ status: 'error', invoice: null, error }));

  const fetchTallyStatus = () => {
    if (!can(user, 'tally.view')) return;
    api.get(`/invoices/${id}/tally-sync`).then(({ data }) => setTallySync(data)).catch(() => setTallySync(null));
  };

  const triggerTallySync = async () => {
    setTallyBusy(true);
    try {
      const { data } = await api.post(`/invoices/${id}/tally-sync`);
      setTallySync(data);
    } catch (err) {
      setNotice(err.message ?? 'Could not sync to Tally');
    } finally {
      setTallyBusy(false);
    }
  };

  const load = () => { setState((s) => ({ ...s, status: 'loading' })); fetchInvoice(); };

  useEffect(() => { fetchInvoice(); fetchTallyStatus(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = async () => {
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/issue`);
      setNotice('Invoice issued.');
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not issue invoice');
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (cancelReason.trim().length < 3) { setNotice('A cancellation reason (at least 3 characters) is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/invoices/${id}/cancel`, { reason: cancelReason.trim() });
      setNotice('Invoice cancelled.');
      setShowCancel(false);
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not cancel invoice');
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (method) => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      const { blob, fileName } = method === 'post' ? await api.postBlob(`/invoices/${id}/pdf`) : await api.getBlob(`/invoices/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      const link = document.createElement('a');
      link.href = url; link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setPdfError(err.message ?? 'Could not load the invoice PDF');
    } finally {
      setPdfBusy(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const inv = state.invoice;
  const isDraft = inv.invoiceStatus === 'DRAFT';
  const isIssued = inv.invoiceStatus === 'ISSUED';
  const canCancel = (isDraft || isIssued) && can(user, 'invoices.cancel');

  return (
    <>
      <PageHeader
        title={inv.invoiceNumber}
        subtitle={formatDate(inv.invoiceDate)}
        actions={(
          <div className="toolbar">
            <StatusBadge status={inv.invoiceStatus} />
            <StatusBadge status={inv.paymentStatus} />
            {isDraft && can(user, 'invoices.update') && (
              <button type="button" className="btn" onClick={() => navigate(`/client/invoices/${id}/edit`)}>Edit draft</button>
            )}
            {isDraft && can(user, 'invoices.issue') && (
              <button type="button" className="btn btn--primary" disabled={busy} onClick={issue}>Issue</button>
            )}
            {isDraft && can(user, 'invoices.view') && (
              <button type="button" className="btn" disabled={pdfBusy} onClick={() => openPdf('get')}>Preview Invoice (Draft)</button>
            )}
            {!isDraft && can(user, 'invoices.view') && (
              <button type="button" className="btn" disabled={pdfBusy} onClick={() => openPdf('get')}>View/Download PDF</button>
            )}
            {!isDraft && can(user, 'invoices.update') && (
              <button type="button" className="btn" disabled={pdfBusy} onClick={() => openPdf('post')}>Regenerate PDF</button>
            )}
            {canCancel && <button type="button" className="btn btn--danger" onClick={() => setShowCancel(true)}>Cancel</button>}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      {pdfBusy && <p className="state" role="status">Preparing the PDF…</p>}
      {pdfError && <p className="state state--error" role="alert">{pdfError}</p>}

      {showCancel && (
        <section className="card">
          <h2>Cancel invoice</h2>
          <label className="field">
            <span>Reason *</span>
            <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} rows={2} required />
          </label>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setShowCancel(false)}>Back</button>
            <button type="button" className="btn btn--danger" disabled={busy} onClick={confirmCancel}>Confirm cancellation</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Supplier</h2>
        <dl className="definition-list">
          <div><dt>Business</dt><dd>{inv.supplierSnapshot?.businessName ?? '—'}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{inv.supplierSnapshot?.gstin ?? '—'}</dd></div>
          <div><dt>State</dt><dd>{inv.supplierSnapshot?.stateCode ?? '—'}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>Customer</h2>
        <dl className="definition-list">
          <div><dt>Name</dt><dd>{inv.customerSnapshot?.name ?? '—'}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{inv.customerSnapshot?.gstin ?? '—'}</dd></div>
          <div><dt>Code</dt><dd className="mono">{inv.customerSnapshot?.customerCode ?? '—'}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>Items</h2>
        <table className="table">
          <thead>
            <tr><th>Product</th><th>HSN/SAC</th><th>Qty</th><th>Unit price</th><th>Discount</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Line total</th></tr>
          </thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.productId + it.lineNo}>
                <td>{it.productName ?? it.description}</td>
                <td className="mono">{it.hsnSacCode ?? '—'}</td>
                <td>{it.quantity}</td>
                <td>{formatMoney(it.unitPrice)}</td>
                <td>{formatMoney(it.discount)}</td>
                <td>{formatMoney(it.taxableAmount)}</td>
                <td>{formatMoney(it.cgst)}</td>
                <td>{formatMoney(it.sgst)}</td>
                <td>{formatMoney(it.igst)}</td>
                <td>{formatMoney(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Totals</h2>
        <dl className="definition-list">
          <div><dt>Subtotal</dt><dd>{formatMoney(inv.subtotal)}</dd></div>
          <div><dt>Discount</dt><dd>{formatMoney(inv.discount)}</dd></div>
          <div><dt>Taxable amount</dt><dd>{formatMoney(inv.taxableAmount)}</dd></div>
          <div><dt>CGST</dt><dd>{formatMoney(inv.cgst)}</dd></div>
          <div><dt>SGST</dt><dd>{formatMoney(inv.sgst)}</dd></div>
          <div><dt>IGST</dt><dd>{formatMoney(inv.igst)}</dd></div>
          <div><dt>Total tax</dt><dd>{formatMoney(inv.totalTax)}</dd></div>
          <div><dt>Grand total</dt><dd><strong>{formatMoney(inv.grandTotal)}</strong></dd></div>
        </dl>
      </section>

      {(inv.notes || inv.termsAndConditions) && (
        <section className="card">
          {inv.notes && <p>{inv.notes}</p>}
          {inv.termsAndConditions && <p>{inv.termsAndConditions}</p>}
        </section>
      )}

      {isIssued && can(user, 'tally.view') && (
        <section className="card">
          <h2>Tally sync</h2>
          <p>
            <StatusBadge status={tallySync?.status === 'SYNCED' ? 'SYNCED' : tallySync?.status === 'FAILED' ? 'FAILED' : tallySync?.status === 'SYNCING' ? 'SYNCING' : tallySync?.status === 'RETRYING' ? 'RETRYING' : 'NOT_SYNCED'} />
          </p>
          {tallySync?.status === 'SYNCED' && (
            <dl className="definition-list">
              <div><dt>Voucher number</dt><dd className="mono">{tallySync.voucherNumber ?? '—'}</dd></div>
              <div><dt>Synced at</dt><dd>{formatDate(tallySync.completedAt)}</dd></div>
            </dl>
          )}
          {(tallySync?.status === 'FAILED' || tallySync?.errorMessage) && (
            <p className="state state--error" role="alert">{tallySync.errorMessage ?? 'Sync failed'}</p>
          )}
          {can(user, 'tally.sync') && (!tallySync || tallySync.status === 'NOT_SYNCED' || tallySync.status === 'FAILED' || tallySync.status === 'RETRYING') && (
            <button type="button" className="btn" disabled={tallyBusy} onClick={triggerTallySync}>
              {tallyBusy ? 'Syncing…' : tallySync?.status === 'FAILED' ? 'Retry sync' : 'Sync to Tally'}
            </button>
          )}
        </section>
      )}

      {inv.invoiceStatus === 'CANCELLED' && (
        <section className="card">
          <h2>Cancellation</h2>
          <p>{inv.cancellationReason}</p>
          <p>{formatDate(inv.cancelledAt)}</p>
        </section>
      )}
    </>
  );
}
