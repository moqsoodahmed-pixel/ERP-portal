import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const PINCODE_RE = /^\d{6}$/;
const blankAddress = { line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '', country: 'IN' };
const blank = {
  name: '', businessName: '', gstin: '', pan: '', phone: '', email: '',
  billingAddress: { ...blankAddress }, shippingAddress: { ...blankAddress }, sameAsBilling: true,
};

function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Customer name is required';
  if (form.gstin && !GSTIN_RE.test(form.gstin)) errors.gstin = 'Invalid GSTIN format (format check only, not government-verified)';
  if (form.pan && !PAN_RE.test(form.pan)) errors.pan = 'Invalid PAN format';
  if (form.billingAddress.pincode && !PINCODE_RE.test(form.billingAddress.pincode)) errors.billingPincode = 'Pincode must be 6 digits';
  if (!form.sameAsBilling && form.shippingAddress.pincode && !PINCODE_RE.test(form.shippingAddress.pincode)) errors.shippingPincode = 'Pincode must be 6 digits';
  return errors;
}

export default function CustomerFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id;
  const [editing, setEditing] = useState(isNew || params.get('edit') === '1');
  const [state, setState] = useState(isNew ? { status: 'ready', customer: null, error: null } : { status: 'loading', customer: null, error: null });
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const fetchCustomer = () => api.get(`/customers/${id}`)
    .then(({ data }) => {
      setState({ status: 'ready', customer: data, error: null });
      setForm({
        name: data.name, businessName: data.businessName ?? '', gstin: data.gstin ?? '', pan: data.pan ?? '',
        phone: data.phone ?? '', email: data.email ?? '',
        billingAddress: { ...blankAddress, ...data.billingAddress }, shippingAddress: { ...blankAddress, ...data.shippingAddress },
        sameAsBilling: JSON.stringify(data.billingAddress ?? {}) === JSON.stringify(data.shippingAddress ?? {}),
      });
    })
    .catch((error) => setState({ status: 'error', customer: null, error }));

  const load = () => { if (!isNew) { setState((s) => ({ ...s, status: 'loading' })); fetchCustomer(); } };

  useEffect(() => { if (!isNew) fetchCustomer(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setBilling = (patch) => setForm((f) => ({ ...f, billingAddress: { ...f.billingAddress, ...patch } }));
  const setShipping = (patch) => setForm((f) => ({ ...f, shippingAddress: { ...f.shippingAddress, ...patch } }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const shipping = form.sameAsBilling ? form.billingAddress : form.shippingAddress;
      const hasAddr = (a) => Object.values(a).some(Boolean);
      const body = {
        name: form.name, businessName: form.businessName || undefined, gstin: form.gstin || undefined, pan: form.pan || undefined,
        phone: form.phone || undefined, email: form.email || undefined,
        billingAddress: hasAddr(form.billingAddress) ? form.billingAddress : undefined,
        shippingAddress: hasAddr(shipping) ? shipping : undefined,
      };
      if (isNew) {
        const { data } = await api.post('/customers', body);
        navigate(`/client/customers/${data._id}`, { state: { created: true } });
      } else {
        await api.patch(`/customers/${id}`, body);
        setEditing(false);
        setNotice('Customer updated.');
        load();
      }
    } catch (err) {
      setNotice(err.message ?? 'Could not save customer');
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  if (editing) {
    return (
      <>
        <PageHeader title={isNew ? 'New customer' : `Edit ${state.customer.name}`} />
        <form className="card form" onSubmit={onSubmit} noValidate>
          {notice && <p className="state" role="status">{notice}</p>}

          <fieldset>
            <legend>Basic info</legend>
            <label className="field">
              <span>Name *</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} required />
              {errors.name && <span className="field__error">{errors.name}</span>}
            </label>
            <label className="field"><span>Business name</span><input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} maxLength={200} /></label>
          </fieldset>

          <fieldset>
            <legend>Tax info</legend>
            <label className="field">
              <span>GSTIN</span>
              <input value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
              {errors.gstin && <span className="field__error">{errors.gstin}</span>}
            </label>
            <label className="field">
              <span>PAN</span>
              <input value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={10} />
              {errors.pan && <span className="field__error">{errors.pan}</span>}
            </label>
          </fieldset>

          <fieldset>
            <legend>Contact</legend>
            <label className="field"><span>Phone</span><input value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></label>
          </fieldset>

          <fieldset>
            <legend>Billing address</legend>
            <label className="field"><span>Line 1</span><input value={form.billingAddress.line1} onChange={(e) => setBilling({ line1: e.target.value })} /></label>
            <label className="field"><span>Line 2</span><input value={form.billingAddress.line2} onChange={(e) => setBilling({ line2: e.target.value })} /></label>
            <label className="field"><span>City</span><input value={form.billingAddress.city} onChange={(e) => setBilling({ city: e.target.value })} /></label>
            <label className="field"><span>State</span><input value={form.billingAddress.state} onChange={(e) => setBilling({ state: e.target.value })} /></label>
            <label className="field"><span>State code</span><input value={form.billingAddress.stateCode} onChange={(e) => setBilling({ stateCode: e.target.value })} maxLength={2} /></label>
            <label className="field">
              <span>Pincode</span>
              <input value={form.billingAddress.pincode} onChange={(e) => setBilling({ pincode: e.target.value })} maxLength={6} />
              {errors.billingPincode && <span className="field__error">{errors.billingPincode}</span>}
            </label>
          </fieldset>

          <fieldset>
            <legend>Shipping address</legend>
            <label className="field field--inline">
              <input type="checkbox" checked={form.sameAsBilling} onChange={(e) => set({ sameAsBilling: e.target.checked })} />
              <span>Same as billing</span>
            </label>
            {!form.sameAsBilling && (
              <>
                <label className="field"><span>Line 1</span><input value={form.shippingAddress.line1} onChange={(e) => setShipping({ line1: e.target.value })} /></label>
                <label className="field"><span>Line 2</span><input value={form.shippingAddress.line2} onChange={(e) => setShipping({ line2: e.target.value })} /></label>
                <label className="field"><span>City</span><input value={form.shippingAddress.city} onChange={(e) => setShipping({ city: e.target.value })} /></label>
                <label className="field"><span>State</span><input value={form.shippingAddress.state} onChange={(e) => setShipping({ state: e.target.value })} /></label>
                <label className="field"><span>State code</span><input value={form.shippingAddress.stateCode} onChange={(e) => setShipping({ stateCode: e.target.value })} maxLength={2} /></label>
                <label className="field">
                  <span>Pincode</span>
                  <input value={form.shippingAddress.pincode} onChange={(e) => setShipping({ pincode: e.target.value })} maxLength={6} />
                  {errors.shippingPincode && <span className="field__error">{errors.shippingPincode}</span>}
                </label>
              </>
            )}
          </fieldset>

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => (isNew ? navigate('/client/customers') : setEditing(false))}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </>
    );
  }

  const { customer } = state;
  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle={customer.customerCode}
        actions={(
          <div className="toolbar">
            <StatusBadge status={customer.status} />
            {can(user, 'customers.update') && customer.status !== 'ARCHIVED' && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit</button>}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      <section className="card">
        <h2>Details</h2>
        <dl className="definition-list">
          <div><dt>Business name</dt><dd>{customer.businessName ?? '—'}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{customer.gstin ?? '—'}</dd></div>
          <div><dt>PAN</dt><dd className="mono">{customer.pan ?? '—'}</dd></div>
          <div><dt>Phone</dt><dd>{customer.phone ?? '—'}</dd></div>
          <div><dt>Email</dt><dd>{customer.email ?? '—'}</dd></div>
        </dl>
      </section>
      <section className="card">
        <h2>Billing address</h2>
        <p>{[customer.billingAddress?.line1, customer.billingAddress?.city, customer.billingAddress?.state, customer.billingAddress?.pincode].filter(Boolean).join(', ') || '—'}</p>
      </section>
      <section className="card">
        <h2>Shipping address</h2>
        <p>{[customer.shippingAddress?.line1, customer.shippingAddress?.city, customer.shippingAddress?.state, customer.shippingAddress?.pincode].filter(Boolean).join(', ') || '—'}</p>
      </section>
    </>
  );
}
