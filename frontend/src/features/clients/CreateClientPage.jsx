import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';

const initial = {
  businessName: '', legalName: '', gstin: '', pan: '', email: '', phone: '',
  address: { line1: '', city: '', state: '', pincode: '' },
  adminName: '', adminEmail: '', adminPassword: '',
};

/** Client-side checks are for UX only; the server remains the single source of truth. */
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
      <form className="card form" onSubmit={onSubmit} noValidate>
        {serverError && <p className="state state--error" role="alert">{serverError}</p>}

        <fieldset>
          <legend>Business info</legend>
          <label className="field">
            <span>Business name *</span>
            <input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} maxLength={200} required />
            {errors.businessName && <span className="field__error">{errors.businessName}</span>}
          </label>
          <label className="field">
            <span>Legal name</span>
            <input value={form.legalName} onChange={(e) => set({ legalName: e.target.value })} maxLength={200} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Tax info</legend>
          <label className="field">
            <span>GSTIN</span>
            <input value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} />
            {errors.gstin && <span className="field__error">{errors.gstin}</span>}
            <span className="muted">Format is validated only — this is not a government verification.</span>
          </label>
          <label className="field">
            <span>PAN</span>
            <input value={form.pan} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} maxLength={10} />
            {errors.pan && <span className="field__error">{errors.pan}</span>}
          </label>
        </fieldset>

        <fieldset>
          <legend>Contact</legend>
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </label>
          <label className="field">
            <span>Phone</span>
            <input value={form.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={20} />
          </label>
        </fieldset>

        <fieldset>
          <legend>Address</legend>
          <label className="field"><span>Address line 1</span><input value={form.address.line1} onChange={(e) => setAddr({ line1: e.target.value })} /></label>
          <label className="field"><span>City</span><input value={form.address.city} onChange={(e) => setAddr({ city: e.target.value })} /></label>
          <label className="field"><span>State</span><input value={form.address.state} onChange={(e) => setAddr({ state: e.target.value })} /></label>
          <label className="field"><span>Pincode</span><input value={form.address.pincode} onChange={(e) => setAddr({ pincode: e.target.value })} maxLength={6} /></label>
        </fieldset>

        <fieldset>
          <legend>Initial Client Admin (optional)</legend>
          <label className="field">
            <span>Name</span>
            <input value={form.adminName} onChange={(e) => set({ adminName: e.target.value })} />
            {errors.adminName && <span className="field__error">{errors.adminName}</span>}
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={form.adminEmail} onChange={(e) => set({ adminEmail: e.target.value })} />
          </label>
          <label className="field">
            <span>Initial password</span>
            <input type="password" value={form.adminPassword} onChange={(e) => set({ adminPassword: e.target.value })} autoComplete="new-password" />
            {errors.adminPassword && <span className="field__error">{errors.adminPassword}</span>}
            <span className="muted">The admin account is created PENDING and must be activated before it can sign in.</span>
          </label>
        </fieldset>

        <div className="dialog__actions">
          <button type="button" className="btn" onClick={() => navigate('/master/clients')}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create client'}</button>
        </div>
      </form>
    </>
  );
}
