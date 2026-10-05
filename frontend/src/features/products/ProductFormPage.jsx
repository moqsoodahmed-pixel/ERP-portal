import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
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
        <form className="card form" onSubmit={onSubmit} noValidate>
          {notice && <p className="state" role="status">{notice}</p>}
          <label className="field">
            <span>Product name *</span>
            <input value={form.productName} onChange={(e) => set({ productName: e.target.value })} maxLength={200} required />
            {errors.productName && <span className="field__error">{errors.productName}</span>}
          </label>
          <label className="field">
            <span>Type *</span>
            <select value={form.type} onChange={(e) => set({ type: e.target.value })}>
              <option value="PRODUCT">Product</option>
              <option value="SERVICE">Service</option>
            </select>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} maxLength={2000} rows={3} />
          </label>
          <label className="field"><span>SKU</span><input value={form.sku} onChange={(e) => set({ sku: e.target.value })} /></label>
          <label className="field">
            <span>HSN/SAC</span>
            <input value={form.hsnSacCode} onChange={(e) => set({ hsnSacCode: e.target.value })} maxLength={8} />
            {errors.hsnSacCode && <span className="field__error">{errors.hsnSacCode}</span>}
          </label>
          <label className="field">
            <span>Unit *</span>
            <select value={form.unit} onChange={(e) => set({ unit: e.target.value })}>
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Selling price *</span>
            <input value={form.sellingPrice} onChange={(e) => set({ sellingPrice: e.target.value })} inputMode="decimal" required />
            {errors.sellingPrice && <span className="field__error">{errors.sellingPrice}</span>}
          </label>
          <label className="field">
            <span>Purchase price</span>
            <input value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} inputMode="decimal" />
            {errors.purchasePrice && <span className="field__error">{errors.purchasePrice}</span>}
          </label>
          <label className="field field--inline">
            <input type="checkbox" checked={form.isGstApplicable} onChange={(e) => set({ isGstApplicable: e.target.checked, gstRate: e.target.checked ? form.gstRate : '' })} />
            <span>GST applicable</span>
          </label>
          {form.isGstApplicable && (
            <label className="field">
              <span>GST rate (%) *</span>
              <input type="number" min="0" max="100" value={form.gstRate} onChange={(e) => set({ gstRate: e.target.value })} />
              {errors.gstRate && <span className="field__error">{errors.gstRate}</span>}
            </label>
          )}
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => (isNew ? navigate('/client/products') : setEditing(false))}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
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
          <div className="toolbar">
            <StatusBadge status={product.status} />
            {can(user, 'products.update') && product.status !== 'ARCHIVED' && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      <section className="card">
        <dl className="definition-list">
          <div><dt>SKU</dt><dd className="mono">{product.sku ?? '—'}</dd></div>
          <div><dt>HSN/SAC</dt><dd className="mono">{product.hsnSacCode ?? '—'}</dd></div>
          <div><dt>Unit</dt><dd>{product.unit}</dd></div>
          <div><dt>Selling price</dt><dd>{formatMoney(product.sellingPrice)}</dd></div>
          <div><dt>Purchase price</dt><dd>{formatMoney(product.purchasePrice)}</dd></div>
          <div><dt>GST</dt><dd>{product.isGstApplicable ? `${product.gstRate}%` : 'Not applicable'}</dd></div>
          <div><dt>Description</dt><dd>{product.description ?? '—'}</dd></div>
        </dl>
      </section>
    </>
  );
}
