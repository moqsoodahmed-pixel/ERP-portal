import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  DefinitionList,
  DefinitionItem,
  Button,
  FormField,
  ErrorState,
  LoadingState,
} from '../../design-system/index.js';
import { formatMoney } from '../../utils/format.js';

const UNITS = ['NOS', 'PCS', 'KG', 'GRAM', 'LTR', 'MTR', 'BOX', 'SET', 'SERVICE'];
const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;

const blank = {
  productName: '', type: 'PRODUCT', description: '', sku: '', hsnSacCode: '', unit: 'NOS',
  sellingPrice: '', purchasePrice: '', isGstApplicable: false, gstRate: '',
};

function validate(form) {
  const errors = {};
  if (!form.productName.trim()) errors.productName = 'Product name is required';
  if (!form.unit) errors.unit = 'Unit is required';
  if (!MONEY_RE.test(String(form.sellingPrice))) errors.sellingPrice = 'Selling price must be a non-negative amount with up to 2 decimals';
  if (form.purchasePrice && !MONEY_RE.test(String(form.purchasePrice))) errors.purchasePrice = 'Invalid purchase price';
  if (form.hsnSacCode && !/^\d{4,8}$/.test(form.hsnSacCode)) errors.hsnSacCode = 'HSN/SAC must be 4-8 digits';
  if (form.isGstApplicable && (form.gstRate === '' || Number.isNaN(Number(form.gstRate)))) errors.gstRate = 'GST rate is required when GST is applicable';
  return errors;
}

export default function ProductFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id;
  const [editing, setEditing] = useState(isNew || params.get('edit') === '1');
  const [state, setState] = useState(isNew ? { status: 'ready', product: null, error: null } : { status: 'loading', product: null, error: null });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const fetchProduct = () => api.get(`/products/${id}`)
    .then(({ data }) => {
      setState({ status: 'ready', product: data, error: null });
      setForm({
        productName: data.productName, type: data.type, description: data.description ?? '', sku: data.sku ?? '',
        hsnSacCode: data.hsnSacCode ?? '', unit: data.unit, sellingPrice: data.sellingPrice, purchasePrice: data.purchasePrice ?? '',
        isGstApplicable: data.isGstApplicable, gstRate: data.gstRate ?? '',
      });
    })
    .catch((error) => setState({ status: 'error', product: null, error }));

  const load = () => { if (!isNew) { setState((s) => ({ ...s, status: 'loading' })); fetchProduct(); } };

  useEffect(() => { if (!isNew) fetchProduct(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const body = {
        productName: form.productName, type: form.type, description: form.description || undefined, sku: form.sku || undefined,
        hsnSacCode: form.hsnSacCode || undefined, unit: form.unit, sellingPrice: String(form.sellingPrice),
        purchasePrice: form.purchasePrice ? String(form.purchasePrice) : undefined,
        isGstApplicable: form.isGstApplicable, gstRate: form.isGstApplicable ? Number(form.gstRate) : 0,
      };
      if (isNew) {
        const { data } = await api.post('/products', body);
        navigate(`/client/products/${data._id}`, { state: { created: true } });
      } else {
        await api.patch(`/products/${id}`, body);
        setEditing(false);
        setNotice('Product updated.');
        load();
      }
    } catch (err) {
      setNotice(err.message ?? 'Could not save product');
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  if (editing) {
    return (
      <>
        <PageHeader title={isNew ? 'New product' : `Edit ${state.product.productName}`} />
        <form onSubmit={onSubmit} noValidate>
          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Product Details" />
            <CardBody>
              {notice && <p className="state" role="status">{notice}</p>}
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                <FormField label="Product name" required error={errors.productName}>
                  <input className="input" value={form.productName} onChange={(e) => set({ productName: e.target.value })} maxLength={200} required />
                </FormField>
                <FormField label="Type" required>
                  <select className="select" value={form.type} onChange={(e) => set({ type: e.target.value })}>
                    <option value="PRODUCT">Product</option>
                    <option value="SERVICE">Service</option>
                  </select>
                </FormField>
                <FormField label="Unit" required>
                  <select className="select" value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
                    {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </FormField>
                <FormField label="SKU">
                  <input className="input" value={form.sku} onChange={(e) => set({ sku: e.target.value })} />
                </FormField>
                <FormField label="HSN/SAC" error={errors.hsnSacCode}>
                  <input className="input" value={form.hsnSacCode} onChange={(e) => set({ hsnSacCode: e.target.value })} maxLength={8} />
                </FormField>
              </div>

              <FormField label="Description" style={{ marginBottom: '1rem' }}>
                <textarea className="textarea" value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} rows={3} />
              </FormField>
            </CardBody>
          </Card>

          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Pricing & Taxes" />
            <CardBody>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                <FormField label="Selling price" required error={errors.sellingPrice}>
                  <input className="input" value={form.sellingPrice} onChange={(e) => set({ sellingPrice: e.target.value })} inputMode="decimal" required />
                </FormField>
                <FormField label="Purchase price" error={errors.purchasePrice}>
                  <input className="input" value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} inputMode="decimal" />
                </FormField>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label className="field field--inline">
                  <input type="checkbox" checked={form.isGstApplicable} onChange={(e) => set({ isGstApplicable: e.target.checked, gstRate: e.target.checked ? form.gstRate : '' })} />
                  <span>GST applicable</span>
                </label>
              </div>

              {form.isGstApplicable && (
                <FormField label="GST rate (%)" required error={errors.gstRate}>
                  <input className="input" type="number" min="0" max="100" value={form.gstRate} onChange={(e) => set({ gstRate: e.target.value })} style={{ maxWidth: '160px' }} />
                </FormField>
              )}
            </CardBody>
          </Card>

          <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
            <Button onClick={() => (isNew ? navigate('/client/products') : setEditing(false))}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </>
    );
  }

  const { product } = state;
  return (
    <>
      <PageHeader
        title={product.productName}
        subtitle={`${product.productCode} · ${product.type}`}
        actions={(
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <StatusBadge status={product.status} />
            {can(user, 'products.update') && product.status !== 'ARCHIVED' && (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      <Card>
        <CardBody>
          <DefinitionList columns={4}>
            <DefinitionItem label="SKU" value={product.sku} mono />
            <DefinitionItem label="HSN/SAC" value={product.hsnSacCode} mono />
            <DefinitionItem label="Unit" value={product.unit} />
            <DefinitionItem label="Selling price" value={formatMoney(product.sellingPrice)} />
            <DefinitionItem label="Purchase price" value={formatMoney(product.purchasePrice)} />
            <DefinitionItem label="GST" value={product.isGstApplicable ? `${product.gstRate}%` : 'Not applicable'} />
            <DefinitionItem label="Description" value={product.description} />
          </DefinitionList>
        </CardBody>
      </Card>
    </>
  );
}
