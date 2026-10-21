import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { formatDateTime } from '../../utils/format.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
  FormField,
  TextInput,
  DefinitionList,
  DefinitionItem,
} from '../../design-system/index.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE_RE = /^\d{6}$/;

const blank = {
  displayName: '', gstin: '', mobile: '', email: '', website: '',
  address: { line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '', country: 'IN' },
  offerings: ['PRODUCT'],
};

function validate(form) {
  const errors = {};
  if (!form.displayName.trim()) errors.displayName = 'Business display name is required';
  if (form.gstin && !GSTIN_RE.test(form.gstin)) errors.gstin = 'Invalid GSTIN format (format check only, not government-verified)';
  if (form.address.pincode && !PINCODE_RE.test(form.address.pincode)) errors.pincode = 'Pincode must be 6 digits';
  if (form.website && !/^https?:\/\/.+/i.test(form.website)) errors.website = 'Website must start with http:// or https://';
  return errors;
}

export default function BusinessProfilePage() {
  const { user } = useAuth();
  const canEdit = can(user, 'business.update');
  const [state, setState] = useState({ status: 'loading', profile: null, error: null });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const fetchProfile = () => api.get('/business-profile')
    .then(({ data }) => setState({ status: 'ready', profile: data, error: null }))
    .catch((error) => {
      if (error.status === 404) setState({ status: 'empty', profile: null, error: null });
      else setState({ status: 'error', profile: null, error });
    });

  const load = () => { setState((s) => ({ ...s, status: 'loading' })); fetchProfile(); };

  useEffect(() => { fetchProfile(); }, []);

  const startEdit = (profile) => {
    setForm({
      displayName: profile?.displayName ?? '', gstin: profile?.gstin ?? '', mobile: profile?.mobile ?? '',
      email: profile?.email ?? '', website: profile?.website ?? '',
      address: { line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '', country: 'IN', ...profile?.address },
      offerings: profile?.offerings?.length ? profile.offerings : ['PRODUCT'],
    });
    setErrors({});
    setNotice(null);
    setEditing(true);
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setAddr = (patch) => setForm((f) => ({ ...f, address: { ...f.address, ...patch } }));
  const toggleOffering = (key) => setForm((f) => ({
    ...f, offerings: f.offerings.includes(key) ? f.offerings.filter((o) => o !== key) : [...f.offerings, key],
  }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      const body = {
        displayName: form.displayName,
        gstin: form.gstin || undefined,
        mobile: form.mobile || undefined,
        email: form.email || undefined,
        website: form.website || undefined,
        address: Object.values(form.address).some(Boolean) ? form.address : undefined,
        offerings: form.offerings.length ? form.offerings : undefined,
      };
      if (state.status === 'empty') await api.post('/business-profile', body);
      else await api.patch('/business-profile', body);
      setEditing(false);
      setNotice('Business profile saved.');
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not save business profile');
    } finally {
      setBusy(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  if (editing) {
    return (
      <div className="page-container">
        <PageHeader title="Business profile" subtitle="Business info, tax info, contact, address and settings." />
        <Card>
          <CardBody>
            <form className="form" onSubmit={onSubmit} noValidate>
              {notice && <p className="state" role="status" style={{ marginBottom: '1.25rem' }}>{notice}</p>}

              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <legend style={{ fontWeight: 600, color: 'var(--ink)', padding: '0 0.5rem' }}>Business info</legend>
                <div style={{ display: 'grid', gap: '1rem' }}>
                  <FormField label="Display name *" error={errors.displayName}>
                    <TextInput value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={200} required />
                  </FormField>
                  <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                    <legend style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--ink-secondary)', marginBottom: '0.5rem' }}>Offerings</legend>
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                      <label className="field field--inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.offerings.includes('PRODUCT')} onChange={() => toggleOffering('PRODUCT')} />
                        <span style={{ fontSize: '0.9375rem', color: 'var(--ink)' }}>Products</span>
                      </label>
                      <label className="field field--inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={form.offerings.includes('SERVICE')} onChange={() => toggleOffering('SERVICE')} />
                        <span style={{ fontSize: '0.9375rem', color: 'var(--ink)' }}>Services</span>
                      </label>
                    </div>
                  </fieldset>
                </div>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <legend style={{ fontWeight: 600, color: 'var(--ink)', padding: '0 0.5rem' }}>Tax info</legend>
                <FormField label="GSTIN" error={errors.gstin} hint="Format is validated only — this is not a government verification.">
                  <TextInput value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
                </FormField>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <legend style={{ fontWeight: 600, color: 'var(--ink)', padding: '0 0.5rem' }}>Contact</legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <FormField label="Mobile">
                    <TextInput value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} maxLength={20} />
                  </FormField>
                  <FormField label="Email">
                    <TextInput type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
                  </FormField>
                  <FormField label="Website" error={errors.website}>
                    <TextInput value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
                  </FormField>
                </div>
              </fieldset>

              <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <legend style={{ fontWeight: 600, color: 'var(--ink)', padding: '0 0.5rem' }}>Address</legend>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FormField label="Address line 1">
                      <TextInput value={form.address.line1} onChange={(e) => setAddr({ line1: e.target.value })} />
                    </FormField>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <FormField label="Address line 2">
                      <TextInput value={form.address.line2} onChange={(e) => setAddr({ line2: e.target.value })} />
                    </FormField>
                  </div>
                  <FormField label="City">
                    <TextInput value={form.address.city} onChange={(e) => setAddr({ city: e.target.value })} />
                  </FormField>
                  <FormField label="State">
                    <TextInput value={form.address.state} onChange={(e) => setAddr({ state: e.target.value })} />
                  </FormField>
                  <FormField label="State code">
                    <TextInput value={form.address.stateCode} onChange={(e) => setAddr({ stateCode: e.target.value })} maxLength={2} />
                  </FormField>
                  <FormField label="Pincode" error={errors.pincode}>
                    <TextInput value={form.address.pincode} onChange={(e) => setAddr({ pincode: e.target.value })} maxLength={6} />
                  </FormField>
                </div>
              </fieldset>

              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="page-container">
        <PageHeader title="Business profile" subtitle="Set up your business profile to appear on future invoices." />
        <Card>
          <CardBody style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
            <div style={{ maxWidth: '440px', margin: '0 auto' }}>
              <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--brand-surface)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem', fontSize: '1.5rem' }}>
                🏢
              </div>
              <h3 style={{ margin: '0 0 0.5rem', color: 'var(--ink)' }}>No business profile configured</h3>
              <p style={{ color: 'var(--ink-secondary)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                No business profile has been set up for this client yet. Set up details to brand and populate future invoices.
              </p>
              {canEdit ? (
                <Button variant="primary" type="button" onClick={() => startEdit(null)}>
                  Set up business profile
                </Button>
              ) : (
                <p className="muted" style={{ margin: 0 }}>Ask a Client Admin to set this up.</p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  const { profile } = state;
  return (
    <div className="page-container">
      <PageHeader
        title={profile.displayName}
        subtitle={`Last updated ${formatDateTime(profile.updatedAt)}`}
        actions={canEdit && <Button variant="outline" type="button" onClick={() => startEdit(profile)}>Edit</Button>}
      />
      {notice && <p className="state" role="status" style={{ marginBottom: '1.25rem' }}>{notice}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.5rem' }}>
        <Card>
          <CardHeader>
            <CardTitle>Tax info</CardTitle>
          </CardHeader>
          <CardBody>
            <DefinitionList>
              <DefinitionItem label="GSTIN" value={<span className="mono">{profile.gstin ?? '—'}</span>} />
            </DefinitionList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardBody>
            <DefinitionList>
              <DefinitionItem label="Mobile" value={profile.mobile ?? '—'} />
              <DefinitionItem label="Email" value={profile.email ?? '—'} />
              <DefinitionItem
                label="Website"
                value={profile.website ? (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                    {profile.website}
                  </a>
                ) : '—'}
              />
            </DefinitionList>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardBody>
            <p style={{ margin: 0, color: 'var(--ink)', lineHeight: 1.6 }}>
              {[profile.address?.line1, profile.address?.line2, profile.address?.city, profile.address?.state, profile.address?.pincode].filter(Boolean).join(', ') || '—'}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Offerings</CardTitle>
          </CardHeader>
          <CardBody>
            <p style={{ margin: 0, color: 'var(--ink)', lineHeight: 1.6 }}>
              {(profile.offerings ?? []).join(', ') || '—'}
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
