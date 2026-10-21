import React, { useState } from 'react';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  FormField,
} from '../../design-system/index.js';

export default function CreateVendorPage() {
  const [form, setForm] = useState({ name: '', contactEmail: '', phone: '', user: { name: '', email: '', password: '' } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post('/vendors', form);
      window.location.assign(`/master/vendors/${res.data.vendor._id}`);
    } catch (err) {
      setError(err.message ?? 'Could not create vendor');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="New GST vendor" subtitle="Creates a filing-partner organisation and its login user." />
      <form onSubmit={submit}>
        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Vendor Organisation" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <FormField label="Vendor name" required>
                <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </FormField>
              <FormField label="Contact email" required>
                <input className="input" type="email" required value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} />
              </FormField>
              <FormField label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </FormField>
            </div>
          </CardBody>
        </Card>

        <Card style={{ marginBottom: '1.25rem' }}>
          <CardHeader title="Initial Login User" />
          <CardBody>
            <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
              <FormField label="Name" required>
                <input className="input" required value={form.user.name} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, name: e.target.value } }))} />
              </FormField>
              <FormField label="Email" required>
                <input className="input" type="email" required value={form.user.email} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, email: e.target.value } }))} />
              </FormField>
              <FormField label="Temporary password" required hint="At least 12 characters">
                <input className="input" type="password" required minLength={12} value={form.user.password} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, password: e.target.value } }))} />
              </FormField>
            </div>
            {error && <p className="state state--error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}
          </CardBody>
        </Card>

        <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem', gap: '0.75rem' }}>
          <Button type="button" onClick={() => window.history.back()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create vendor'}
          </Button>
        </div>
      </form>
    </>
  );
}
