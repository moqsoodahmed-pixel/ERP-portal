import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import { LoadingState } from '../../components/states.jsx';
import { formatMoney } from '../../utils/format.js';

const blankLine = { productId: '', quantity: '1', discount: '0' };

/**
 * Client-side totals below are a PREVIEW ONLY, computed from the product's own gstRate for convenience.
 * They are never sent to the API — the server always recomputes authoritative totals from scratch.
 */
function previewLine(line, products) {
  const product = products.find((p) => p._id === line.productId);
  if (!product) return null;
  const qty = Number(line.quantity) || 0;
  const unitPrice = Number(product.sellingPrice) || 0;
  const discount = Number(line.discount) || 0;
  const gross = qty * unitPrice;
  const taxable = Math.max(gross - discount, 0);
  const rate = product.isGstApplicable ? Number(product.gstRate) || 0 : 0;
  const tax = taxable * (rate / 100);
  return { product, taxable, tax, lineTotal: taxable + tax };
}

export default function InvoiceFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [loading, setLoading] = useState(isEdit);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [gstApplicable, setGstApplicable] = useState(true);
  const [interState, setInterState] = useState(false);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ ...blankLine }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/customers?limit=100').then(({ data }) => setCustomers(data.items)).catch(() => {});
    api.get('/products?limit=100&status=ACTIVE').then(({ data }) => setProducts(data.items)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/invoices/${id}`).then(({ data }) => {
      if (data.invoiceStatus !== 'DRAFT') { navigate(`/client/invoices/${id}`); return; }
      setCustomerId(data.customerId);
      setInvoiceDate(data.invoiceDate?.slice(0, 10) ?? invoiceDate);
      setDueDate(data.dueDate?.slice(0, 10) ?? '');
      setGstApplicable(data.gstApplicable);
      setInterState(data.interState);
      setNotes(data.notes ?? '');
      setLines(data.items.map((it) => ({ productId: it.productId, quantity: String(it.quantity), discount: String(it.discount ?? 0) })));
      setLoading(false);
    }).catch((err) => { setError(err.message ?? 'Could not load invoice'); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { ...blankLine }]);
  const removeLine = (idx) => setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));

  const previews = useMemo(() => lines.map((l) => previewLine(l, products)), [lines, products]);
  const previewTotal = previews.reduce((sum, p) => sum + (p ? p.lineTotal : 0), 0);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const items = lines
      .filter((l) => l.productId)
      .map((l) => ({ productId: l.productId, quantity: String(l.quantity || '0'), discount: l.discount ? String(l.discount) : undefined }));
    if (!customerId) { setError('Select a customer'); return; }
    if (items.length === 0) { setError('Add at least one line item'); return; }
    setBusy(true);
    const body = { customerId, invoiceDate, dueDate: dueDate || undefined, gstApplicable, interState, notes: notes || undefined, items };
    try {
      const { data } = isEdit ? await api.patch(`/invoices/${id}`, body) : await api.post('/invoices', body);
      navigate(`/client/invoices/${data._id}`, { state: { created: !isEdit } });
    } catch (err) {
      setError(err.message ?? 'Could not save invoice');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Edit draft invoice' : 'New invoice'}
        subtitle="Saved as DRAFT. Totals shown below are a preview — the server recomputes authoritative totals on save."
      />
      <form className="card form" onSubmit={onSubmit} noValidate>
        {error && <p className="field__error" role="alert">{error}</p>}
        <label className="field">
          <span>Customer *</span>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Select a customer…</option>
            {customers.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.customerCode})</option>)}
          </select>
        </label>
        <label className="field"><span>Invoice date *</span><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required /></label>
        <label className="field"><span>Due date</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label>
        <label className="field field--inline"><input type="checkbox" checked={gstApplicable} onChange={(e) => setGstApplicable(e.target.checked)} /><span>GST applicable</span></label>
        <label className="field field--inline"><input type="checkbox" checked={interState} onChange={(e) => setInterState(e.target.checked)} /><span>Inter-state supply (IGST instead of CGST+SGST)</span></label>
        <label className="field"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} /></label>

        <fieldset>
          <legend>Items</legend>
          <table className="table">
            <thead>
              <tr><th>Product</th><th>Qty</th><th>Discount</th><th>Taxable (preview)</th><th>Tax (preview)</th><th>Line total (preview)</th><th /></tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx}>
                  <td>
                    <select value={line.productId} onChange={(e) => setLine(idx, { productId: e.target.value })}>
                      <option value="">Select…</option>
                      {products.map((p) => <option key={p._id} value={p._id}>{p.productName} ({formatMoney(p.sellingPrice)})</option>)}
                    </select>
                  </td>
                  <td><input value={line.quantity} inputMode="decimal" onChange={(e) => setLine(idx, { quantity: e.target.value })} style={{ width: '5rem' }} /></td>
                  <td><input value={line.discount} inputMode="decimal" onChange={(e) => setLine(idx, { discount: e.target.value })} style={{ width: '6rem' }} /></td>
                  <td>{previews[idx] ? formatMoney(previews[idx].taxable.toFixed(2)) : '—'}</td>
                  <td>{previews[idx] ? formatMoney(previews[idx].tax.toFixed(2)) : '—'}</td>
                  <td>{previews[idx] ? formatMoney(previews[idx].lineTotal.toFixed(2)) : '—'}</td>
                  <td><button type="button" className="btn" onClick={() => removeLine(idx)} disabled={lines.length === 1}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn" onClick={addLine}>Add item</button>
        </fieldset>

        <p><strong>Preview grand total (not authoritative): {formatMoney(previewTotal.toFixed(2))}</strong></p>

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => navigate('/client/invoices')}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Save as draft')}</button>
        </div>
      </form>
    </>
  );
}
