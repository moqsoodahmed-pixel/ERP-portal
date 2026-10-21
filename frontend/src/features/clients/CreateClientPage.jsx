import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  FormField,
} from '../../design-system/index.js';

const initial = {
  businessName: '', legalName: '', gstin: '', pan: '', email: '', phone: '',
  address: { line1: '', city: '', state: '', pincode: '' },
  adminName: '', adminEmail: '', adminPassword: '',
};

function validate(form) {
  const errors = {};
  if (!form.businessName.trim()) errors.businessName = 'Business name is required';
  if (form.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(form.gstin)) errors.gstin = 'Invalid GSTIN format';
  if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(form.pan)) errors.pan = 'Invalid PAN format';
  if (form.adminEmail && !form.adminName) errors.adminName = 'Admin name is required when an email is given';
  if (form.adminEmail && form.adminPassword.length < 12) errors.adminPassword = 'Initial password must be at least 12 characters';
  return errors;
}

export default function CreateClientPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (patch) => setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const body = {
        businessName: form.businessName,
        legalName: form.legalName || undefined,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: Object.values(form.address).some(Boolean) ? form.address : undefined,
        admin: form.adminEmail ? { name: form.adminName, email: form.adminEmail, password: form.adminPassword } : undefined,
      };
      const { data } = await api.post('/clients', body);
      navigate(`/master/clients/${data.tenant._id}`, { state: { created: true } });
    } catch (err) {
      setServerError(err.message ?? 'Could not create client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="New client" subtitle="Onboard a business onto the platform." />
      <form onSubmit={onSubmit} noValidate>
        {serverError && <p className="state state--error" role="alert" style={{ marginBottom: '1.25rem' }}>{serverError}</p>}

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Business info" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <FormField label="Business name" required error={errors.businessName}>
                <input className="input" value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} maxLength={200} required />
              </FormField>
              <FormField label="Legal name">
                <input className="input" value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} maxLength={200} />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Tax info" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <FormField label="GSTIN" hint="Format is validated only — this is not a government verification." error={errors.gstin}>
                <input className="input" value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
              </FormField>
              <FormField label="PAN" error={errors.pan}>
                <input className="input" value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={10} />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Contact & Address" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <FormField label="Email">
                <input className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
              </FormField>
              <FormField label="Phone">
                <input className="input" value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
              </FormField>
            </div>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              <FormField label="Address line 1">
                <input className="input" value={form.address.line1} onChange={(e) => setAddr({ line1: e.target.value })} />
              </FormField>
              <FormField label="City">
                <input className="input" value={form.address.city} onChange={(e) => setAddr({ city: e.target.value })} />
              </FormField>
              <FormField label="State">
                <input className="input" value={form.address.state} onChange={(e) => setAddr({ state: e.target.value })} />
              </FormField>
              <FormField label="Pincode">
                <input className="input" value={form.address.pincode} onChange={(e) => setAddr({ pincode: e.target.value })} maxLength={6} />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Initial Client Admin (optional)" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <FormField label="Name" error={errors.adminName}>
                <input className="input" value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} />
              </FormField>
              <FormField label="Email">
                <input className="input" type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} />
              </FormField>
              <FormField label="Initial password" hint="The admin account is created PENDING and must be activated before it can sign in." error={errors.adminPassword}>
                <input className="input" type="password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} autoComplete="new-password" />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
          <Button onClick={() => navigate('/master/clients')}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create client'}
          </Button>
        </div>
      </form>
    </>
  );
}
