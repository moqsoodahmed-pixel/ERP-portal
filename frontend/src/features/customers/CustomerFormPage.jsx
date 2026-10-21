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
  Checkbox,
  ErrorState,
  LoadingState,
} from '../../design-system/index.js';

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
        <form onSubmit={onSubmit} noValidate>
          {notice && <p className="state" role="status">{notice}</p>}

          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Basic info" />
            <CardBody>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <FormField label="Name" required error={errors.name}>
                  <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={200} required />
                </FormField>
                <FormField label="Business name">
                  <input className="input" value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} maxLength={200} />
                </FormField>
              </div>
            </CardBody>
          </Card>

          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Tax & Contact" />
            <CardBody>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <FormField label="GSTIN" error={errors.gstin}>
                  <input className="input" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
                </FormField>
                <FormField label="PAN" error={errors.pan}>
                  <input className="input" value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={10} />
                </FormField>
                <FormField label="Phone">
                  <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
                </FormField>
                <FormField label="Email">
                  <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                </FormField>
              </div>
            </CardBody>
          </Card>

          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Billing address" />
            <CardBody>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <FormField label="Line 1"><input className="input" value={form.billingAddress.line1} onChange={(e) => setBilling({ line1: e.target.value })} /></FormField>
                <FormField label="Line 2"><input className="input" value={form.billingAddress.line2} onChange={(e) => setBilling({ line2: e.target.value })} /></FormField>
                <FormField label="City"><input className="input" value={form.billingAddress.city} onChange={(e) => setBilling({ city: e.target.value })} /></FormField>
                <FormField label="State"><input className="input" value={form.billingAddress.state} onChange={(e) => setBilling({ state: e.target.value })} /></FormField>
                <FormField label="State code"><input className="input" value={form.billingAddress.stateCode} onChange={(e) => setBilling({ stateCode: e.target.value })} maxLength={2} /></FormField>
                <FormField label="Pincode" error={errors.billingPincode}>
                  <input className="input" value={form.billingAddress.pincode} onChange={(e) => setBilling({ pincode: e.target.value })} maxLength={6} />
                </FormField>
              </div>
            </CardBody>
          </Card>

          <Card style={{ marginBottom: '1.25rem' }}>
            <CardHeader title="Shipping address" />
            <CardBody>
              <div style={{ marginBottom: '1rem' }}>
                <Checkbox
                  checked={form.sameAsBilling}
                  onChange={(e) => set({ sameAsBilling: e.target.checked })}
                  label="Same as billing"
                />
              </div>
              {!form.sameAsBilling && (
                <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  <FormField label="Line 1"><input className="input" value={form.shippingAddress.line1} onChange={(e) => setShipping({ line1: e.target.value })} /></FormField>
                  <FormField label="Line 2"><input className="input" value={form.shippingAddress.line2} onChange={(e) => setShipping({ line2: e.target.value })} /></FormField>
                  <FormField label="City"><input className="input" value={form.shippingAddress.city} onChange={(e) => setShipping({ city: e.target.value })} /></FormField>
                  <FormField label="State"><input className="input" value={form.shippingAddress.state} onChange={(e) => setShipping({ state: e.target.value })} /></FormField>
                  <FormField label="State code"><input className="input" value={form.shippingAddress.stateCode} onChange={(e) => setShipping({ stateCode: e.target.value })} maxLength={2} /></FormField>
                  <FormField label="Pincode" error={errors.shippingPincode}>
                    <input className="input" value={form.shippingAddress.pincode} onChange={(e) => setShipping({ pincode: e.target.value })} maxLength={6} />
                  </FormField>
                </div>
              )}
            </CardBody>
          </Card>

          <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
            <Button onClick={() => (isNew ? navigate('/client/customers') : setEditing(false))}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
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
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <StatusBadge status={customer.status} />
            {can(user, 'customers.update') && customer.status !== 'ARCHIVED' && (
              <Button onClick={() => setEditing(true)}>Edit</Button>
            )}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Details" />
        <CardBody>
          <DefinitionList columns={3}>
            <DefinitionItem label="Business name" value={customer.businessName} />
            <DefinitionItem label="GSTIN" value={customer.gstin} mono />
            <DefinitionItem label="PAN" value={customer.pan} mono />
            <DefinitionItem label="Phone" value={customer.phone} />
            <DefinitionItem label="Email" value={customer.email} />
          </DefinitionList>
        </CardBody>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
        <Card>
          <CardHeader title="Billing address" />
          <CardBody>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6 }}>
              {[customer.billingAddress?.line1, customer.billingAddress?.city, customer.billingAddress?.state, customer.billingAddress?.pincode].filter(Boolean).join(', ') || '—'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Shipping address" />
          <CardBody>
            <p style={{ margin: 0, fontSize: '14px', lineHeight: 1.6 }}>
              {[customer.shippingAddress?.line1, customer.shippingAddress?.city, customer.shippingAddress?.state, customer.shippingAddress?.pincode].filter(Boolean).join(', ') || '—'}
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
