import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import { LoadingState } from '../../components/states.jsx';
import { RETURN_TYPES } from './filingsApi.js';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const blankForm = { periodKey: '', returnType: 'GSTR_1', displayName: '', gstin: '', address: '' };

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function validate(form, logoError) {
  const errors = {};
  if (!form.periodKey) errors.periodKey = 'Filing period is required.';
  if (!form.returnType) errors.returnType = 'Return type is required.';
  if (!form.displayName.trim()) errors.displayName = 'Company name is required.';
  if (!form.gstin.trim()) errors.gstin = 'Please enter a valid GSTIN.';
  else if (!GSTIN_RE.test(form.gstin)) errors.gstin = 'Please enter a valid GSTIN.';
  if (!form.address.trim()) errors.address = 'Company address is required.';
  if (logoError) errors.logo = logoError;
  return errors;
}

export default function NewFilingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profileExists, setProfileExists] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [logoError, setLogoError] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [hadExistingLogo, setHadExistingLogo] = useState(false);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [createdFiling, setCreatedFiling] = useState(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: profile } = await api.get('/business-profile');
        setProfileExists(true);
        setForm((f) => ({
          ...f,
          displayName: profile.displayName ?? '',
          gstin: profile.gstin ?? '',
          address: profile.address?.line1 ?? '',
        }));
        if (profile.logoFileId) {
          setHadExistingLogo(true);
          try {
            const { blob } = await api.getBlob('/business-profile/logo');
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            setLogoPreview(url);
          } catch { /* logo fetch is best-effort; the form still works without a preview */ }
        }
      } catch (err) {
        if (err.status !== 404) setNotice(err.message ?? 'Could not load existing business profile');
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError(null);
    if (!ALLOWED_LOGO_MIME.includes(file.type)) { setLogoError('Logo must be a JPEG, PNG or WEBP image.'); return; }
    if (file.size > MAX_LOGO_BYTES) { setLogoError('Logo must be 2MB or smaller.'); return; }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setLogoFile(file);
    setLogoPreview(url);
    setRemoveLogo(false);
  };

  const onRemoveLogo = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setLogoFile(null);
    setLogoPreview(null);
    setRemoveLogo(hadExistingLogo);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validate(form, logoError);
    setErrors(v);
    if (Object.keys(v).length) return;
    setBusy(true);
    setNotice(null);
    try {
      const addressPatch = { line1: form.address.trim().slice(0, 200) };
      const companyBody = { displayName: form.displayName.trim(), gstin: form.gstin.trim().toUpperCase(), address: addressPatch };
      if (profileExists) await api.patch('/business-profile', companyBody);
      else await api.post('/business-profile', companyBody);

      if (logoFile) {
        const contentBase64 = await fileToBase64(logoFile);
        await api.post('/business-profile/logo', { fileName: logoFile.name, mimeType: logoFile.type, contentBase64 });
      } else if (removeLogo) {
        await api.delete('/business-profile/logo');
      }

      const { data: filing } = await api.post('/gst-filings', { periodKey: form.periodKey, returnType: form.returnType });
      setCreatedFiling(filing);
      setNotice('Company details saved successfully.');
    } catch (err) {
      setNotice(err.message ?? 'Unable to save company details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState />;

  if (createdFiling) {
    return (
      <>
        <PageHeader title="New GST Filing" subtitle="Add your company details to create a new GST filing." />
        <section className="card">
          <p className="state state--ok" role="status">✓ Company details saved successfully.</p>
          <p className="muted">Next: Create Bill</p>
          <div className="dialog__actions">
            <button type="button" className="btn btn--primary" onClick={() => navigate(`/client/gst-filings/${createdFiling._id}/bill`)}>Continue</button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHeader title="New GST Filing" subtitle="Add your company details to create a new GST filing." />
      <form className="card form" onSubmit={onSubmit} noValidate>
        {notice && <p className="state state--error" role="alert">{notice}</p>}

        <fieldset>
          <legend>Filing details</legend>
          <div className="form-grid">
            <label className="field">
              <span>Filing period *</span>
              <input type="month" value={form.periodKey} onChange={(e) => set({ periodKey: e.target.value })} required />
              {errors.periodKey && <span className="field__error">{errors.periodKey}</span>}
            </label>
            <label className="field">
              <span>Return type *</span>
              <select value={form.returnType} onChange={(e) => set({ returnType: e.target.value })}>
                {RETURN_TYPES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Company details</legend>

          <div className="logo-upload">
            <span>Company logo</span>
            <div className="logo-upload__preview">
              {logoPreview ? <img src={logoPreview} alt="Company logo preview" /> : <span>Logo Preview</span>}
            </div>
            <div className="toolbar toolbar--tight">
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                {logoPreview ? 'Replace logo' : 'Upload logo'}
              </button>
              {logoPreview && <button type="button" className="btn" onClick={onRemoveLogo}>Remove logo</button>}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={onLogoChange}
              style={{ display: 'none' }}
            />
            {errors.logo && <span className="field__error">{errors.logo}</span>}
          </div>

          <div className="form-grid">
            <label className="field field--full">
              <span>Company name *</span>
              <input value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} maxLength={200} required />
              {errors.displayName && <span className="field__error">{errors.displayName}</span>}
            </label>

            <label className="field field--full">
              <span>GST number / GSTIN *</span>
              <input value={form.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} maxLength={15} required />
              {errors.gstin && <span className="field__error">{errors.gstin}</span>}
              <span className="muted">Format is validated only — this is not a government verification.</span>
            </label>

            <label className="field field--full">
              <span>Address *</span>
              <textarea rows={4} value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={200} required />
              {errors.address && <span className="field__error">{errors.address}</span>}
            </label>
          </div>
        </fieldset>

        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
        </div>
      </form>
    </>
  );
}
