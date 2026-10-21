import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  FormField,
  Select,
  DatePicker,
  Checkbox,
  Textarea,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  LoadingState,
} from '../../design-system/index.js';
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

  const customerOptions = customers.map((c) => ({
    value: c._id,
    label: `${c.name} (${c.customerCode})`,
  }));

  const productOptions = products.map((p) => ({
    value: p._id,
    label: `${p.productName} (${formatMoney(p.sellingPrice)})`,
  }));

  return (
    <>
      <PageHeader
        title={isEdit ? 'Edit draft invoice' : 'New invoice'}
        subtitle="Saved as DRAFT. Totals shown below are a preview — the server recomputes authoritative totals on save."
      />
      <form onSubmit={onSubmit} noValidate>
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Invoice Details" />
          <CardBody>
            {error && <p className="field__error" role="alert" style={{ marginBottom: '1rem' }}>{error}</p>}

            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <FormField label="Customer" required>
                <Select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  placeholder="Select a customer…"
                  options={customerOptions}
                  required
                />
              </FormField>

              <FormField label="Invoice date" required>
                <DatePicker
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  required
                />
              </FormField>

              <FormField label="Due date">
                <DatePicker
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </FormField>
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <Checkbox
                checked={gstApplicable}
                onChange={(e) => setGstApplicable(e.target.checked)}
                label="GST applicable"
              />
              <Checkbox
                checked={interState}
                onChange={(e) => setInterState(e.target.checked)}
                label="Inter-state supply (IGST instead of CGST+SGST)"
              />
            </div>

            <FormField label="Notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Optional invoice notes or payment terms…"
              />
            </FormField>
          </CardBody>
        </Card>

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Line Items" subtitle="Select products, quantities, and optional discounts" />
          <CardBody>
            <Table caption="Invoice Draft Line Items">
              <TableHead>
                <TableRow hover={false}>
                  <TableHeaderCell>Product</TableHeaderCell>
                  <TableHeaderCell numeric>Qty</TableHeaderCell>
                  <TableHeaderCell numeric>Discount</TableHeaderCell>
                  <TableHeaderCell numeric>Taxable (preview)</TableHeaderCell>
                  <TableHeaderCell numeric>Tax (preview)</TableHeaderCell>
                  <TableHeaderCell numeric>Line total (preview)</TableHeaderCell>
                  <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                </TableRow>
              </TableHead>
              <tbody>
                {lines.map((line, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Select
                        value={line.productId}
                        onChange={(e) => setLine(idx, { productId: e.target.value })}
                        placeholder="Select product…"
                        options={productOptions}
                      />
                    </TableCell>
                    <TableCell numeric>
                      <input
                        className="input"
                        value={line.quantity}
                        inputMode="decimal"
                        onChange={(e) => setLine(idx, { quantity: e.target.value })}
                        style={{ width: '5rem', textAlign: 'right' }}
                      />
                    </TableCell>
                    <TableCell numeric>
                      <input
                        className="input"
                        value={line.discount}
                        inputMode="decimal"
                        onChange={(e) => setLine(idx, { discount: e.target.value })}
                        style={{ width: '6rem', textAlign: 'right' }}
                      />
                    </TableCell>
                    <TableCell numeric>
                      {previews[idx] ? formatMoney(previews[idx].taxable.toFixed(2)) : '—'}
                    </TableCell>
                    <TableCell numeric>
                      {previews[idx] ? formatMoney(previews[idx].tax.toFixed(2)) : '—'}
                    </TableCell>
                    <TableCell numeric>
                      <strong>{previews[idx] ? formatMoney(previews[idx].lineTotal.toFixed(2)) : '—'}</strong>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                      >
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </tbody>
            </Table>

            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button onClick={addLine}>+ Add item</Button>
              <div style={{ fontSize: '15px' }}>
                Preview grand total: <strong>{formatMoney(previewTotal.toFixed(2))}</strong>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
          <Button onClick={() => navigate('/client/invoices')}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Save as draft')}
          </Button>
        </div>
      </form>
    </>
  );
}
