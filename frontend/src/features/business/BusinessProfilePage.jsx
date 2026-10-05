import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { formatDateTime } from '../../utils/format.js';

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
      <>
        <PageHeader title="Business profile" subtitle="Business info, tax info, contact, address and settings." />
        <form className="card form" onSubmit={onSubmit} noValidate>
          {notice && <p className="state" role="status">{notice}</p>}

          <fieldset>
            <legend>Business info</legend>
            <label className="field">
              <span>Display name *</span>
              <input value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={200} required />
              {errors.displayName && <span className="field__error">{errors.displayName}</span>}
            </label>
            <fieldset>
              <legend>Offerings</legend>
              <label className="field field--inline"><input type="checkbox" checked={form.offerings.includes('PRODUCT')} onChange={() => toggleOffering('PRODUCT')} /><span>Products</span></label>
              <label className="field field--inline"><input type="checkbox" checked={form.offerings.includes('SERVICE')} onChange={() => toggleOffering('SERVICE')} /><span>Services</span></label>
            </fieldset>
          </fieldset>

          <fieldset>
            <legend>Tax info</legend>
            <label className="field">
              <span>GSTIN</span>
              <input value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
              {errors.gstin && <span className="field__error">{errors.gstin}</span>}
              <span className="muted">Format is validated only — this is not a government verification.</span>
            </label>
          </fieldset>

          <fieldset>
            <legend>Contact</legend>
            <label className="field"><span>Mobile</span><input value={form.mobile} onChange={(e) => set({ mobile: e.target.value })} maxLength={20} /></label>
            <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} /></label>
            <label className="field">
              <span>Website</span>
              <input value={form.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://" />
              {errors.website && <span className="field__error">{errors.website}</span>}
            </label>
          </fieldset>

          <fieldset>
            <legend>Address</legend>
            <label className="field"><span>Address line 1</span><input value={form.address.line1} onChange={(e) => setAddr({ line1: e.target.value })} /></label>
            <label className="field"><span>Address line 2</span><input value={form.address.line2} onChange={(e) => setAddr({ line2: e.target.value })} /></label>
            <label className="field"><span>City</span><input value={form.address.city} onChange={(e) => setAddr({ city: e.target.value })} /></label>
            <label className="field"><span>State</span><input value={form.address.state} onChange={(e) => setAddr({ state: e.target.value })} /></label>
            <label className="field"><span>State code</span><input value={form.address.stateCode} onChange={(e) => setAddr({ stateCode: e.target.value })} maxLength={2} /></label>
            <label className="field">
              <span>Pincode</span>
              <input value={form.address.pincode} onChange={(e) => setAddr({ pincode: e.target.value })} maxLength={6} />
              {errors.pincode && <span className="field__error">{errors.pincode}</span>}
            </label>
          </fieldset>

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </>
    );
  }

  if (state.status === 'empty') {
    return (
      <>
        <PageHeader title="Business profile" subtitle="Set up your business profile to appear on future invoices." />
        <section className="card placeholder">
          <p>No business profile has been set up for this client yet.</p>
          {canEdit
            ? <button type="button" className="btn btn--primary" onClick={() => startEdit(null)}>Set up business profile</button>
            : <p className="muted">Ask a Client Admin to set this up.</p>}
        </section>
      </>
    );
  }

  const { profile } = state;
  return (
    <>
      <PageHeader
        title={profile.displayName}
        subtitle={`Last updated ${formatDateTime(profile.updatedAt)}`}
        actions={canEdit && <button type="button" className="btn" onClick={() => startEdit(profile)}>Edit</button>}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      <section className="card">
        <h2>Tax info</h2>
        <dl className="definition-list">
          <div><dt>GSTIN</dt><dd className="mono">{profile.gstin ?? '—'}</dd></div>
        </dl>
      </section>
      <section className="card">
        <h2>Contact</h2>
        <dl className="definition-list">
          <div><dt>Mobile</dt><dd>{profile.mobile ?? '—'}</dd></div>
          <div><dt>Email</dt><dd>{profile.email ?? '—'}</dd></div>
          <div><dt>Website</dt><dd>{profile.website ?? '—'}</dd></div>
        </dl>
      </section>
      <section className="card">
        <h2>Address</h2>
        <p>{[profile.address?.line1, profile.address?.line2, profile.address?.city, profile.address?.state, profile.address?.pincode].filter(Boolean).join(', ') || '—'}</p>
      </section>
      <section className="card">
        <h2>Offerings</h2>
        <p>{(profile.offerings ?? []).join(', ') || '—'}</p>
      </section>
    </>
  );
}
