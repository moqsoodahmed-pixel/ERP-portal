import React, { useEffect, useState, useRef } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  FormField,
  TextInput,
  Textarea,
  Modal,
  LoadingState,
  ErrorState,
} from '../../design-system/index.js';
import { formatDateTime } from '../../utils/format.js';

const DEFAULT_MARGINS = { top: 36, bottom: 36, left: 36, right: 36 };
const DEFAULT_COLORS = { primary: '#0f172a', secondary: '#64748b', accent: '#2563eb' };
const DEFAULT_TYPOGRAPHY = { fontFamily: 'Inter, system-ui, sans-serif', headingAlignment: 'left' };
const DEFAULT_WATERMARK = { opacity: 0.12, scale: 260 };

export default function LetterheadBuilderPage() {
  const { user } = useAuth();
  const canEdit = can(user, 'business.update');

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [activeTemplate, setActiveTemplate] = useState(null);
  const [activeTab, setActiveTab] = useState('branding'); // 'branding' | 'styling' | 'watermark' | 'legal_bank' | 'sections'
  const [showSafeGuide, setShowSafeGuide] = useState(true);
  const [showBleedGuide, setShowBleedGuide] = useState(false);
  const [historyModalOpen, setShowHistoryModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [assetUrls, setAssetUrls] = useState({
    logo: null,
    background: null,
    watermark: null,
    signature: null,
    seal: null,
    qrCode: null,
  });
  const assetUrlsRef = useRef({});
  assetUrlsRef.current = assetUrls;

  // File input refs for quick asset uploads
  const logoInputRef = useRef(null);
  const bgInputRef = useRef(null);
  const watermarkInputRef = useRef(null);
  const sigInputRef = useRef(null);
  const sealInputRef = useRef(null);
  const qrInputRef = useRef(null);

  const loadAssetBlob = async (endpoint) => {
    try {
      const { blob } = await api.getBlob(endpoint);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  };

  const loadAllAssetBlobs = async (p) => {
    if (!p) return;
    const [logo, background, watermark, signature, seal, qrCode] = await Promise.all([
      p.logoFileId ? loadAssetBlob('/business-profile/logo') : null,
      p.letterheadBackgroundFileId ? loadAssetBlob('/business-profile/background') : null,
      p.watermarkFileId ? loadAssetBlob('/business-profile/watermark') : null,
      p.signatureFileId ? loadAssetBlob('/business-profile/signature') : null,
      p.sealFileId ? loadAssetBlob('/business-profile/seal') : null,
      p.qrCodeFileId ? loadAssetBlob('/business-profile/qr-code') : null,
    ]);
    setAssetUrls((prev) => {
      const next = { logo, background, watermark, signature, seal, qrCode };
      Object.keys(prev).forEach((k) => {
        if (prev[k] && prev[k] !== next[k]) {
          try { URL.revokeObjectURL(prev[k]); } catch { /* ignore */ }
        }
      });
      return next;
    });
  };

  useEffect(() => {
    return () => {
      Object.values(assetUrlsRef.current).forEach((url) => {
        if (url) {
          try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        }
      });
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileRes, templatesRes] = await Promise.all([
        api.get('/business-profile').catch(() => ({ data: null })),
        api.get('/business-profile/letterheads').catch(() => ({ data: [] })),
      ]);
      setProfile(profileRes.data);
      if (profileRes.data) {
        await loadAllAssetBlobs(profileRes.data);
      }
      const tList = templatesRes.data || [];
      setTemplates(tList);
      if (tList.length > 0) {
        const def = tList.find((t) => t.isDefault) || tList[0];
        setActiveTemplate(def);
      } else if (profileRes.data) {
        // Fallback or initial default draft template from profile
        const initialT = {
          name: 'Standard Corporate Letterhead',
          isDefault: true,
          margins: { ...DEFAULT_MARGINS },
          colors: { ...DEFAULT_COLORS },
          typography: { ...DEFAULT_TYPOGRAPHY },
          pan: profileRes.data.pan || '',
          msme: profileRes.data.msme || '',
          cin: profileRes.data.cin || '',
          watermarkSettings: { ...DEFAULT_WATERMARK },
          bankDetails: profileRes.data.bankDetails || {},
          footerText: profileRes.data.footerText || '',
          declaration: profileRes.data.declaration || '',
          defaultTermsAndConditions: profileRes.data.defaultTermsAndConditions || '',
          authorizedSignatoryName: profileRes.data.authorizedSignatoryName || '',
          authorizedSignatoryDesignation: profileRes.data.authorizedSignatoryDesignation || '',
          customSections: [
            { id: 'sec-1', title: 'Payment Instructions', content: 'Please quote invoice number on transfer payments.', order: 0, visible: true },
          ],
          history: [{ version: 1, savedAt: new Date(), note: 'System template' }],
        };
        setActiveTemplate(initialT);
      }
    } catch (err) {
      setError(err.message || 'Failed to load letterhead configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateTemplate = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const newDto = {
        name: `Letterhead ${templates.length + 1}`,
        isDefault: templates.length === 0,
        margins: { ...DEFAULT_MARGINS },
        colors: { ...DEFAULT_COLORS },
        typography: { ...DEFAULT_TYPOGRAPHY },
        pan: profile?.pan || '',
        msme: profile?.msme || '',
        cin: profile?.cin || '',
        watermarkSettings: { ...DEFAULT_WATERMARK },
        bankDetails: profile?.bankDetails || {},
        footerText: profile?.footerText || '',
        declaration: profile?.declaration || '',
        defaultTermsAndConditions: profile?.defaultTermsAndConditions || '',
        authorizedSignatoryName: profile?.authorizedSignatoryName || '',
        authorizedSignatoryDesignation: profile?.authorizedSignatoryDesignation || '',
        customSections: [],
      };
      const res = await api.post('/business-profile/letterheads', newDto);
      setNotice('New letterhead template created.');
      await loadData();
      setActiveTemplate(res.data);
    } catch (err) {
      setError(err.message || 'Could not create template');
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicateTemplate = async (templateId) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const res = await api.post(`/business-profile/letterheads/${templateId}/duplicate`);
      setNotice('Letterhead duplicated.');
      await loadData();
      setActiveTemplate(res.data);
    } catch (err) {
      setError(err.message || 'Could not duplicate template');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTemplate = async (templateId) => {
    if (!canEdit) return;
    if (!window.confirm('Are you sure you want to delete this letterhead template?')) return;
    setBusy(true);
    try {
      await api.delete(`/business-profile/letterheads/${templateId}`);
      setNotice('Letterhead deleted.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not delete template');
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async (templateId) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      await api.post(`/business-profile/letterheads/${templateId}/set-default`);
      setNotice('Default letterhead set.');
      await loadData();
    } catch (err) {
      setError(err.message || 'Could not set default');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveActiveTemplate = async () => {
    if (!canEdit || !activeTemplate) return;
    setBusy(true);
    setError(null);
    try {
      if (activeTemplate._id) {
        await api.patch(`/business-profile/letterheads/${activeTemplate._id}`, activeTemplate);
        setNotice('Letterhead template saved successfully.');
      } else {
        const created = await api.post('/business-profile/letterheads', activeTemplate);
        setActiveTemplate(created.data);
        setNotice('Letterhead created and saved.');
      }
      await loadData();
    } catch (err) {
      setError(err.message || 'Failed to save letterhead');
    } finally {
      setBusy(false);
    }
  };

  const handleAssetUpload = async (assetType, file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result;
          const comma = typeof res === 'string' ? res.indexOf(',') : -1;
          resolve(comma !== -1 ? res.slice(comma + 1) : res);
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      let mime = file.type || '';
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!mime || mime === 'image/jpg') {
        if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
        else if (ext === 'png') mime = 'image/png';
        else if (ext === 'webp') mime = 'image/webp';
      }

      const res = await api.post(`/business-profile/${assetType}`, {
        fileName: file.name,
        mimeType: mime || 'image/png',
        contentBase64: String(base64).replace(/\s+/g, ''),
      });
      setNotice(`${assetType.charAt(0).toUpperCase() + assetType.slice(1)} uploaded successfully.`);
      const updatedProfile = res.data;
      setProfile(updatedProfile);
      await loadAllAssetBlobs(updatedProfile);
    } catch (err) {
      setError(err.message || 'Asset upload failed');
    } finally {
      setBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
      if (bgInputRef.current) bgInputRef.current.value = '';
      if (watermarkInputRef.current) watermarkInputRef.current.value = '';
      if (sigInputRef.current) sigInputRef.current.value = '';
      if (sealInputRef.current) sealInputRef.current.value = '';
      if (qrInputRef.current) qrInputRef.current.value = '';
    }
  };

  const handleAssetRemove = async (assetType) => {
    if (!canEdit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.delete(`/business-profile/${assetType}`);
      setNotice(`${assetType.charAt(0).toUpperCase() + assetType.slice(1)} removed.`);
      const updatedProfile = res.data;
      setProfile(updatedProfile);
      await loadAllAssetBlobs(updatedProfile);
    } catch (err) {
      setError(err.message || 'Could not remove asset');
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadPdfPreview = async () => {
    setPdfBusy(true);
    try {
      const { blob, fileName } = await api.getBlob('/business-profile/letterhead/preview');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName || 'letterhead-preview.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      setError(err.message || 'Could not generate PDF preview');
    } finally {
      setPdfBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading letterhead builder…" />;

  const t = activeTemplate || {
    name: 'Standard Corporate Letterhead',
    margins: DEFAULT_MARGINS,
    colors: DEFAULT_COLORS,
    typography: DEFAULT_TYPOGRAPHY,
    watermarkSettings: DEFAULT_WATERMARK,
    bankDetails: {},
    customSections: [],
  };

  const updateT = (patch) => setActiveTemplate((prev) => ({ ...prev, ...patch }));
  const updateMargins = (patch) => updateT({ margins: { ...(t.margins || DEFAULT_MARGINS), ...patch } });
  const updateColors = (patch) => updateT({ colors: { ...(t.colors || DEFAULT_COLORS), ...patch } });
  const updateTypography = (patch) => updateT({ typography: { ...(t.typography || DEFAULT_TYPOGRAPHY), ...patch } });
  const updateWatermark = (patch) => updateT({ watermarkSettings: { ...(t.watermarkSettings || DEFAULT_WATERMARK), ...patch } });
  const updateBank = (patch) => updateT({ bankDetails: { ...(t.bankDetails || {}), ...patch } });

  // Custom section helpers
  const addCustomSection = () => {
    const newSec = {
      id: `sec-${Date.now()}`,
      title: 'New Section',
      content: '',
      order: (t.customSections || []).length,
      visible: true,
    };
    updateT({ customSections: [...(t.customSections || []), newSec] });
  };

  const updateCustomSection = (id, patch) => {
    const list = (t.customSections || []).map((sec) => (sec.id === id ? { ...sec, ...patch } : sec));
    updateT({ customSections: list });
  };

  const moveCustomSection = (index, direction) => {
    const list = [...(t.customSections || [])];
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const temp = list[index];
    list[index] = list[target];
    list[target] = temp;
    updateT({ customSections: list });
  };

  const removeCustomSection = (id) => {
    updateT({ customSections: (t.customSections || []).filter((s) => s.id !== id) });
  };

  return (
    <div className="letterhead-builder-page" style={{ paddingBottom: '3rem' }}>
      <PageHeader
        title="Letterhead Builder"
        subtitle="Full custom letterhead workspace: A4 margins, bleed guides, custom fonts, digital signatures, company seals, watermarks, and bank QR codes."
        actions={(
          <div className="toolbar" style={{ alignItems: 'center' }}>
            {canEdit && (
              <>
                <Button variant="outline" onClick={handleCreateTemplate} disabled={busy}>+ New letterhead</Button>
                <Button variant="primary" onClick={handleSaveActiveTemplate} disabled={busy}>
                  {busy ? 'Saving…' : 'Save letterhead'}
                </Button>
              </>
            )}
            <Button onClick={() => window.print()}>Print</Button>
            <Button variant="outline" onClick={handleDownloadPdfPreview} disabled={pdfBusy}>
              {pdfBusy ? 'Generating PDF…' : 'Download PDF Preview'}
            </Button>
          </div>
        )}
      />

      {notice && <p className="state" role="status" style={{ marginBottom: '1rem' }}>{notice}</p>}
      {error && <ErrorState error={{ message: error }} onRetry={loadData} />}

      {/* Template Switcher Bar */}
      <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', padding: '0.5rem 0', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {templates.map((tpl) => (
          <button
            key={tpl._id}
            type="button"
            onClick={() => setActiveTemplate(tpl)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 'var(--radius-md)',
              border: t._id === tpl._id ? '2px solid var(--brand)' : '1px solid var(--border)',
              background: t._id === tpl._id ? 'var(--surface)' : 'transparent',
              color: 'var(--ink)',
              fontWeight: t._id === tpl._id ? 600 : 400,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{tpl.name}</span>
            {tpl.isDefault && <span className="badge badge--ok" style={{ fontSize: '10px' }}>Default</span>}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 450px) 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* LEFT COLUMN: Controls & Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Template Info Card */}
          <Card>
            <CardHeader
              title="Template Options"
              actions={(
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {t._id && !t.isDefault && canEdit && (
                    <Button variant="outline" size="sm" onClick={() => handleSetDefault(t._id)}>Set Default</Button>
                  )}
                  {t._id && canEdit && (
                    <Button variant="outline" size="sm" onClick={() => handleDuplicateTemplate(t._id)}>Duplicate</Button>
                  )}
                  {t.history?.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => setShowHistoryModal(true)}>History ({t.history.length})</Button>
                  )}
                  {t._id && canEdit && templates.length > 1 && (
                    <Button variant="danger" size="sm" onClick={() => handleDeleteTemplate(t._id)}>Delete</Button>
                  )}
                </div>
              )}
            />
            <CardBody>
              <FormField label="Template name" required>
                <TextInput
                  value={t.name || ''}
                  onChange={(e) => updateT({ name: e.target.value })}
                  placeholder="e.g. Corporate Billing Letterhead"
                />
              </FormField>
            </CardBody>
          </Card>

          {/* Builder Navigation Tabs */}
          <div style={{ display: 'flex', gap: '4px', background: 'var(--surface-sunken)', padding: '4px', borderRadius: 'var(--radius-md)', overflowX: 'auto' }}>
            {[
              { id: 'branding', label: 'Assets & Brand' },
              { id: 'styling', label: 'Margins & Colors' },
              { id: 'watermark', label: 'Watermark' },
              { id: 'legal_bank', label: 'Tax & Bank' },
              { id: 'sections', label: 'Sections & Terms' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '12px',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  border: 'none',
                  borderRadius: '4px',
                  background: activeTab === tab.id ? 'var(--surface)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--ink)' : 'var(--ink-secondary)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: Assets & Branding */}
          {activeTab === 'branding' && (
            <Card>
              <CardHeader title="Company Visual Assets" />
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Logo */}
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong>Company Logo</strong>
                    {profile?.logoFileId && (
                      <Button variant="outline" size="sm" onClick={() => handleAssetRemove('logo')}>Remove</Button>
                    )}
                  </div>
                  {profile?.logoFileId && assetUrls.logo && (
                    <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                      <img src={assetUrls.logo} alt="Logo preview" style={{ height: '36px', maxWidth: '140px', objectFit: 'contain', display: 'block' }} />
                    </div>
                  )}
                  <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('logo', e.target.files[0])} />
                  <div>
                    <Button variant="outline" onClick={() => logoInputRef.current?.click()}>
                      {profile?.logoFileId ? 'Replace Logo' : 'Upload Logo (PNG, JPG)'}
                    </Button>
                  </div>
                </div>

                {/* Background */}
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong>Background Artwork (Full Page)</strong>
                    {profile?.letterheadBackgroundFileId && (
                      <Button variant="outline" size="sm" onClick={() => handleAssetRemove('background')}>Remove</Button>
                    )}
                  </div>
                  {profile?.letterheadBackgroundFileId && assetUrls.background && (
                    <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                      <img src={assetUrls.background} alt="Background preview" style={{ height: '50px', maxWidth: '80px', objectFit: 'cover', display: 'block' }} />
                    </div>
                  )}
                  <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('background', e.target.files[0])} />
                  <div>
                    <Button variant="outline" onClick={() => bgInputRef.current?.click()}>
                      {profile?.letterheadBackgroundFileId ? 'Replace Background' : 'Upload Background Artwork'}
                    </Button>
                  </div>
                </div>

                {/* Digital Signature */}
                <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong>Digital Signature</strong>
                    {profile?.signatureFileId && (
                      <Button variant="outline" size="sm" onClick={() => handleAssetRemove('signature')}>Remove</Button>
                    )}
                  </div>
                  {profile?.signatureFileId && assetUrls.signature && (
                    <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                      <img src={assetUrls.signature} alt="Signature preview" style={{ height: '30px', maxWidth: '120px', objectFit: 'contain', display: 'block' }} />
                    </div>
                  )}
                  <input ref={sigInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('signature', e.target.files[0])} />
                  <div>
                    <Button variant="outline" onClick={() => sigInputRef.current?.click()}>
                      {profile?.signatureFileId ? 'Replace Signature' : 'Upload Digital Signature'}
                    </Button>
                  </div>
                </div>

                {/* Company Seal / Stamp */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong>Company Seal / Stamp</strong>
                    {profile?.sealFileId && (
                      <Button variant="outline" size="sm" onClick={() => handleAssetRemove('seal')}>Remove</Button>
                    )}
                  </div>
                  {profile?.sealFileId && assetUrls.seal && (
                    <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                      <img src={assetUrls.seal} alt="Seal preview" style={{ height: '40px', maxWidth: '40px', objectFit: 'contain', display: 'block' }} />
                    </div>
                  )}
                  <input ref={sealInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('seal', e.target.files[0])} />
                  <div>
                    <Button variant="outline" onClick={() => sealInputRef.current?.click()}>
                      {profile?.sealFileId ? 'Replace Seal' : 'Upload Official Seal'}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* TAB 2: Styling & Margins */}
          {activeTab === 'styling' && (
            <Card>
              <CardHeader title="Page Layout, Margins & Colors" />
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <strong>A4 Margins (pt)</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <FormField label="Top margin">
                      <TextInput
                        type="number"
                        value={t.margins?.top ?? 36}
                        onChange={(e) => updateMargins({ top: Number(e.target.value) })}
                      />
                    </FormField>
                    <FormField label="Bottom margin">
                      <TextInput
                        type="number"
                        value={t.margins?.bottom ?? 36}
                        onChange={(e) => updateMargins({ bottom: Number(e.target.value) })}
                      />
                    </FormField>
                    <FormField label="Left margin">
                      <TextInput
                        type="number"
                        value={t.margins?.left ?? 36}
                        onChange={(e) => updateMargins({ left: Number(e.target.value) })}
                      />
                    </FormField>
                    <FormField label="Right margin">
                      <TextInput
                        type="number"
                        value={t.margins?.right ?? 36}
                        onChange={(e) => updateMargins({ right: Number(e.target.value) })}
                      />
                    </FormField>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <strong>Palette & Typography</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <FormField label="Primary color">
                      <input
                        type="color"
                        value={t.colors?.primary || '#0f172a'}
                        onChange={(e) => updateColors({ primary: e.target.value })}
                        style={{ width: '100%', height: '36px', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border)' }}
                      />
                    </FormField>
                    <FormField label="Secondary color">
                      <input
                        type="color"
                        value={t.colors?.secondary || '#64748b'}
                        onChange={(e) => updateColors({ secondary: e.target.value })}
                        style={{ width: '100%', height: '36px', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border)' }}
                      />
                    </FormField>
                    <FormField label="Accent color">
                      <input
                        type="color"
                        value={t.colors?.accent || '#2563eb'}
                        onChange={(e) => updateColors({ accent: e.target.value })}
                        style={{ width: '100%', height: '36px', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border)' }}
                      />
                    </FormField>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <FormField label="Font Family">
                      <select
                        className="select"
                        value={t.typography?.fontFamily || 'Helvetica'}
                        onChange={(e) => updateTypography({ fontFamily: e.target.value })}
                      >
                        <option value="Inter, system-ui, sans-serif">Inter (Modern Clean)</option>
                        <option value="Roboto, sans-serif">Roboto</option>
                        <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                        <option value="Georgia, serif">Georgia (Classic Serif)</option>
                      </select>
                    </FormField>
                    <FormField label="Header Alignment">
                      <select
                        className="select"
                        value={t.typography?.headingAlignment || 'left'}
                        onChange={(e) => updateTypography({ headingAlignment: e.target.value })}
                      >
                        <option value="left">Left Aligned</option>
                        <option value="center">Centered</option>
                        <option value="right">Right Aligned</option>
                      </select>
                    </FormField>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* TAB 3: Watermark Editor */}
          {activeTab === 'watermark' && (
            <Card>
              <CardHeader title="Watermark Studio" />
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Watermark Image</span>
                  {profile?.watermarkFileId && (
                    <Button variant="outline" size="sm" onClick={() => handleAssetRemove('watermark')}>Remove</Button>
                  )}
                </div>
                {profile?.watermarkFileId && assetUrls.watermark && (
                  <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                    <img src={assetUrls.watermark} alt="Watermark preview" style={{ height: '40px', maxWidth: '80px', objectFit: 'contain', display: 'block' }} />
                  </div>
                )}
                <input ref={watermarkInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('watermark', e.target.files[0])} />
                <div>
                  <Button variant="outline" onClick={() => watermarkInputRef.current?.click()}>
                    {profile?.watermarkFileId ? 'Replace Watermark Image' : 'Upload Watermark Image'}
                  </Button>
                </div>

                <FormField label={`Opacity: ${Math.round((t.watermarkSettings?.opacity ?? 0.12) * 100)}%`}>
                  <input
                    type="range"
                    min="0.02"
                    max="0.8"
                    step="0.02"
                    value={t.watermarkSettings?.opacity ?? 0.12}
                    onChange={(e) => updateWatermark({ opacity: parseFloat(e.target.value) })}
                    style={{ width: '100%' }}
                  />
                </FormField>

                <FormField label={`Scale: ${t.watermarkSettings?.scale ?? 260}px`}>
                  <input
                    type="range"
                    min="100"
                    max="500"
                    step="20"
                    value={t.watermarkSettings?.scale ?? 260}
                    onChange={(e) => updateWatermark({ scale: parseInt(e.target.value, 10) })}
                    style={{ width: '100%' }}
                  />
                </FormField>
              </CardBody>
            </Card>
          )}

          {/* TAB 4: Tax & Bank Details */}
          {activeTab === 'legal_bank' && (
            <Card>
              <CardHeader title="Legal & Bank Details" />
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <FormField label="GSTIN">
                    <TextInput value={profile?.gstin || ''} disabled title="Configured in Business Profile" />
                  </FormField>
                  <FormField label="PAN">
                    <TextInput
                      value={t.pan || ''}
                      onChange={(e) => updateT({ pan: e.target.value.toUpperCase() })}
                      maxLength={10}
                      placeholder="e.g. ABCDE1234F"
                    />
                  </FormField>
                  <FormField label="MSME Udyam No.">
                    <TextInput
                      value={t.msme || ''}
                      onChange={(e) => updateT({ msme: e.target.value })}
                      placeholder="UDYAM-XX-00-0000000"
                    />
                  </FormField>
                  <FormField label="CIN">
                    <TextInput
                      value={t.cin || ''}
                      onChange={(e) => updateT({ cin: e.target.value })}
                      placeholder="U12345KA2026PTC000000"
                    />
                  </FormField>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <strong>Bank Account Information</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <FormField label="Bank Name">
                      <TextInput
                        value={t.bankDetails?.bankName || ''}
                        onChange={(e) => updateBank({ bankName: e.target.value })}
                        placeholder="State Bank of India"
                      />
                    </FormField>
                    <FormField label="Account Name">
                      <TextInput
                        value={t.bankDetails?.accountName || ''}
                        onChange={(e) => updateBank({ accountName: e.target.value })}
                        placeholder="Company Business A/C"
                      />
                    </FormField>
                    <FormField label="Account Number">
                      <TextInput
                        value={t.bankDetails?.accountNumber || ''}
                        onChange={(e) => updateBank({ accountNumber: e.target.value })}
                        placeholder="XXXXXXXXXXXX"
                      />
                    </FormField>
                    <FormField label="IFSC Code">
                      <TextInput
                        value={t.bankDetails?.ifsc || ''}
                        onChange={(e) => updateBank({ ifsc: e.target.value.toUpperCase() })}
                        placeholder="SBIN0000000"
                      />
                    </FormField>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <FormField label="Branch">
                        <TextInput
                          value={t.bankDetails?.branch || ''}
                          onChange={(e) => updateBank({ branch: e.target.value })}
                          placeholder="MG Road Branch"
                        />
                      </FormField>
                    </div>
                  </div>
                </div>

                {/* QR Code */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <strong>Payment QR Code</strong>
                    {profile?.qrCodeFileId && (
                      <Button variant="outline" size="sm" onClick={() => handleAssetRemove('qr-code')}>Remove</Button>
                    )}
                  </div>
                  {profile?.qrCodeFileId && assetUrls.qrCode && (
                    <div style={{ margin: '8px 0', padding: '6px', background: 'var(--surface-sunken)', borderRadius: '4px', display: 'inline-block' }}>
                      <img src={assetUrls.qrCode} alt="Payment QR preview" style={{ height: '48px', maxWidth: '48px', objectFit: 'contain', display: 'block' }} />
                    </div>
                  )}
                  <input ref={qrInputRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => handleAssetUpload('qr-code', e.target.files[0])} />
                  <div>
                    <Button variant="outline" onClick={() => qrInputRef.current?.click()}>
                      {profile?.qrCodeFileId ? 'Replace QR Code' : 'Upload Bank / UPI QR Code'}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          {/* TAB 5: Sections & Notes */}
          {activeTab === 'sections' && (
            <Card>
              <CardHeader
                title="Terms, Footer & Custom Blocks"
                actions={<Button size="sm" variant="outline" onClick={addCustomSection}>+ Add block</Button>}
              />
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <FormField label="Default Terms and Conditions">
                  <Textarea
                    rows={2}
                    value={t.defaultTermsAndConditions || ''}
                    onChange={(e) => updateT({ defaultTermsAndConditions: e.target.value })}
                    placeholder="Goods once sold will not be returned…"
                  />
                </FormField>

                <FormField label="Declaration">
                  <Textarea
                    rows={2}
                    value={t.declaration || ''}
                    onChange={(e) => updateT({ declaration: e.target.value })}
                    placeholder="We declare that this invoice shows the actual price of the goods described…"
                  />
                </FormField>

                <FormField label="Footer notes">
                  <Textarea
                    rows={2}
                    value={t.footerText || ''}
                    onChange={(e) => updateT({ footerText: e.target.value })}
                    placeholder="Registered Office: #100 Commercial Street…"
                  />
                </FormField>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <strong>Authorized Signatory Info</strong>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <FormField label="Signatory Name">
                      <TextInput
                        value={t.authorizedSignatoryName || ''}
                        onChange={(e) => updateT({ authorizedSignatoryName: e.target.value })}
                        placeholder="John Doe"
                      />
                    </FormField>
                    <FormField label="Signatory Designation">
                      <TextInput
                        value={t.authorizedSignatoryDesignation || ''}
                        onChange={(e) => updateT({ authorizedSignatoryDesignation: e.target.value })}
                        placeholder="Managing Director"
                      />
                    </FormField>
                  </div>
                </div>

                {/* Custom Blocks List */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <strong>Reorderable Custom Blocks</strong>
                  {(t.customSections || []).length === 0 && (
                    <p className="muted" style={{ fontSize: '13px', marginTop: '4px' }}>No custom sections added yet.</p>
                  )}
                  {(t.customSections || []).map((sec, idx) => (
                    <div key={sec.id} style={{ border: '1px solid var(--border)', borderRadius: '4px', padding: '0.75rem', marginTop: '0.5rem', background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <TextInput
                          value={sec.title}
                          onChange={(e) => updateCustomSection(sec.id, { title: e.target.value })}
                          style={{ fontWeight: 600, maxWidth: '200px' }}
                        />
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <Button size="sm" variant="outline" onClick={() => moveCustomSection(idx, -1)} disabled={idx === 0}>↑</Button>
                          <Button size="sm" variant="outline" onClick={() => moveCustomSection(idx, 1)} disabled={idx === (t.customSections.length - 1)}>↓</Button>
                          <Button size="sm" variant="outline" onClick={() => updateCustomSection(sec.id, { visible: !sec.visible })}>
                            {sec.visible ? 'Hide' : 'Show'}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => removeCustomSection(sec.id)}>✕</Button>
                        </div>
                      </div>
                      <Textarea
                        rows={2}
                        value={sec.content}
                        onChange={(e) => updateCustomSection(sec.id, { content: e.target.value })}
                        placeholder="Content of this section…"
                      />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* RIGHT COLUMN: Interactive Live A4 Canvas Preview */}
        <div>
          <Card>
            <CardHeader
              title="Live A4 Canvas Preview"
              actions={(
                <div className="toolbar" style={{ alignItems: 'center', gap: '1rem' }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSafeGuide}
                      onChange={(e) => setShowSafeGuide(e.target.checked)}
                    />
                    A4 Safe Area
                  </label>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showBleedGuide}
                      onChange={(e) => setShowBleedGuide(e.target.checked)}
                    />
                    Bleed Area
                  </label>
                </div>
              )}
            />
            <CardBody style={{ background: '#e2e8f0', padding: '1.5rem', display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
              {/* Virtual A4 Sheet (210mm x 297mm proportion, styled for crisp screen rendering) */}
              <div
                className="a4-sheet-canvas"
                style={{
                  width: '595px',
                  minHeight: '842px',
                  background: '#ffffff',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                  position: 'relative',
                  padding: `${t.margins?.top ?? 36}px ${t.margins?.right ?? 36}px ${t.margins?.bottom ?? 36}px ${t.margins?.left ?? 36}px`,
                  fontFamily: t.typography?.fontFamily || 'Inter, sans-serif',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                }}
              >
                {/* Bleed Guide Layer */}
                {showBleedGuide && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      border: '2px dashed #f43f5e',
                      pointerEvents: 'none',
                      zIndex: 30,
                    }}
                  >
                    <span style={{ position: 'absolute', top: 4, left: 4, color: '#f43f5e', fontSize: '10px', fontWeight: 600 }}>
                      Bleed Box (Full Canvas Edge)
                    </span>
                  </div>
                )}

                {/* Safe Area Guide Layer */}
                {showSafeGuide && (
                  <div
                    style={{
                      position: 'absolute',
                      top: `${t.margins?.top ?? 36}px`,
                      left: `${t.margins?.left ?? 36}px`,
                      right: `${t.margins?.right ?? 36}px`,
                      bottom: `${t.margins?.bottom ?? 36}px`,
                      border: '1px dashed #3b82f6',
                      pointerEvents: 'none',
                      zIndex: 30,
                    }}
                  >
                    <span style={{ position: 'absolute', bottom: 4, right: 4, color: '#3b82f6', fontSize: '10px', fontWeight: 600 }}>
                      A4 Print Safe Boundary
                    </span>
                  </div>
                )}

                {/* Background Asset */}
                {profile?.letterheadBackgroundFileId && assetUrls.background && (
                  <img
                    src={assetUrls.background}
                    alt="Letterhead background"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                  />
                )}

                {/* Watermark Overlay */}
                {profile?.watermarkFileId && assetUrls.watermark && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      opacity: t.watermarkSettings?.opacity ?? 0.12,
                      width: `${t.watermarkSettings?.scale ?? 260}px`,
                      height: `${t.watermarkSettings?.scale ?? 260}px`,
                      pointerEvents: 'none',
                      zIndex: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <img
                      src={assetUrls.watermark}
                      alt="Watermark"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                )}

                {/* Content Container (Layered above watermark & background) */}
                <div style={{ position: 'relative', zIndex: 10 }}>
                  {/* Header */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: t.typography?.headingAlignment === 'center' ? 'center' : 'space-between',
                      alignItems: 'flex-start',
                      borderBottom: `2px solid ${t.colors?.accent || '#2563eb'}`,
                      paddingBottom: '12px',
                      marginBottom: '16px',
                    }}
                  >
                    <div>
                      {profile?.logoFileId && assetUrls.logo && (
                        <img
                          src={assetUrls.logo}
                          alt="Logo"
                          style={{ height: '48px', objectFit: 'contain', marginBottom: '6px' }}
                        />
                      )}
                      <h2 style={{ margin: '0 0 4px 0', fontSize: '18px', color: t.colors?.primary || '#0f172a', fontWeight: 700 }}>
                        {profile?.displayName || 'Your Company Name'}
                      </h2>
                      <div style={{ fontSize: '11px', color: t.colors?.secondary || '#64748b', lineHeight: 1.4 }}>
                        {profile?.address?.line1 ? `${profile.address.line1}, ` : ''}{profile?.address?.city || 'Bengaluru, Karnataka - 560001'}
                        <br />
                        GSTIN: <strong>{profile?.gstin || '29AAAAA0000A1Z5'}</strong>
                        {t.pan && <span> | PAN: <strong>{t.pan}</strong></span>}
                        {t.msme && <span> | MSME: <strong>{t.msme}</strong></span>}
                        {t.cin && <span> | CIN: <strong>{t.cin}</strong></span>}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div
                        style={{
                          border: '1px solid #cbd5e1',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: t.colors?.primary || '#0f172a',
                          background: '#f8fafc',
                        }}
                      >
                        TAX INVOICE
                      </div>
                      <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
                        # INV-2026-001
                      </div>
                    </div>
                  </div>

                  {/* Sample Invoice Info */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '11px', marginBottom: '16px' }}>
                    <div>
                      <strong style={{ color: t.colors?.secondary || '#64748b', textTransform: 'uppercase', fontSize: '10px' }}>Bill To</strong>
                      <div style={{ fontWeight: 600, marginTop: '2px' }}>Acme Global Services Pvt. Ltd.</div>
                      <div style={{ color: '#64748b' }}>MG Road, Brigade Towers, Bangalore - 560025</div>
                      <div style={{ color: '#64748b' }}>GSTIN: 29ABCDE1234F1Z5</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>Invoice Date: <strong>{new Date().toLocaleDateString('en-IN')}</strong></div>
                      <div>Due Date: <strong>{new Date(Date.now() + 15 * 86400000).toLocaleDateString('en-IN')}</strong></div>
                    </div>
                  </div>

                  {/* Sample Items Table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', marginBottom: '16px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #cbd5e1', textAlign: 'left' }}>
                        <th style={{ padding: '6px 8px', width: '24px' }}>#</th>
                        <th style={{ padding: '6px 8px' }}>Product / Service</th>
                        <th style={{ padding: '6px 8px', width: '50px' }}>HSN</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: '30px' }}>Qty</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: '60px' }}>Rate</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: '70px' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '6px 8px' }}>1</td>
                        <td style={{ padding: '6px 8px' }}>Monthly ERP SaaS Subscription</td>
                        <td style={{ padding: '6px 8px' }}>998213</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>1</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>₹ 5,000.00</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>₹ 5,000.00</td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '6px 8px' }}>2</td>
                        <td style={{ padding: '6px 8px' }}>Professional Tax Consultancy</td>
                        <td style={{ padding: '6px 8px' }}>998231</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>1</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>₹ 2,000.00</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>₹ 2,000.00</td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Totals Box */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
                    <div style={{ width: '220px', fontSize: '11px', lineHeight: 1.6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Taxable Value:</span>
                        <span>₹ 7,000.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>CGST (9%):</span>
                        <span>₹ 630.00</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                        <span>SGST (9%):</span>
                        <span>₹ 630.00</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          borderTop: '2px solid #0f172a',
                          paddingTop: '4px',
                          marginTop: '4px',
                          fontWeight: 700,
                          fontSize: '12px',
                          color: t.colors?.primary || '#0f172a',
                        }}
                      >
                        <span>Grand Total:</span>
                        <span>₹ 8,260.00</span>
                      </div>
                    </div>
                  </div>

                  {/* Bank Details & QR Section */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      border: '1px solid #e2e8f0',
                      borderRadius: '4px',
                      padding: '10px 12px',
                      background: '#f8fafc',
                      fontSize: '10.5px',
                      marginBottom: '14px',
                    }}
                  >
                    <div>
                      <strong style={{ color: t.colors?.primary || '#0f172a', display: 'block', marginBottom: '2px' }}>
                        Bank & Remittance Details
                      </strong>
                      <div>Bank: <strong>{t.bankDetails?.bankName || 'State Bank of India'}</strong></div>
                      <div>Account: <strong>{t.bankDetails?.accountNumber || '1234567890'}</strong></div>
                      <div>IFSC: <strong>{t.bankDetails?.ifsc || 'SBIN000000'}</strong></div>
                      <div>A/C Name: <strong>{t.bankDetails?.accountName || profile?.displayName || 'LauncherDesk ERP'}</strong></div>
                    </div>
                    {profile?.qrCodeFileId && assetUrls.qrCode && (
                      <div style={{ textAlign: 'center' }}>
                        <img
                          src={assetUrls.qrCode}
                          alt="QR Code"
                          style={{ width: '56px', height: '56px', objectFit: 'contain' }}
                        />
                        <div style={{ fontSize: '9px', color: '#64748b', marginTop: '2px' }}>Scan to Pay</div>
                      </div>
                    )}
                  </div>

                  {/* Custom Blocks */}
                  {(t.customSections || []).filter((s) => s.visible).map((sec) => (
                    <div key={sec.id} style={{ fontSize: '10.5px', marginBottom: '8px' }}>
                      <strong>{sec.title}:</strong>
                      <div style={{ color: '#475569', whiteSpace: 'pre-line' }}>{sec.content}</div>
                    </div>
                  ))}

                  {/* Terms & Conditions & Declaration */}
                  {t.defaultTermsAndConditions && (
                    <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '6px' }}>
                      <strong>Terms & Conditions: </strong>{t.defaultTermsAndConditions}
                    </div>
                  )}

                  {t.declaration && (
                    <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginBottom: '14px' }}>
                      <strong>Declaration: </strong>{t.declaration}
                    </div>
                  )}

                  {/* Signatory Section */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '20px' }}>
                    {/* Seal */}
                    {profile?.sealFileId && assetUrls.seal ? (
                      <img
                        src={assetUrls.seal}
                        alt="Company Seal"
                        style={{ width: '70px', height: '70px', objectFit: 'contain' }}
                      />
                    ) : <div />}

                    {/* Signature */}
                    <div style={{ textAlign: 'center', width: '160px' }}>
                      {profile?.signatureFileId && assetUrls.signature && (
                        <img
                          src={assetUrls.signature}
                          alt="Signature"
                          style={{ maxHeight: '42px', maxWidth: '140px', objectFit: 'contain', marginBottom: '4px' }}
                        />
                      )}
                      <div style={{ borderTop: '1px solid #94a3b8', paddingTop: '4px', fontSize: '10px', fontWeight: 600 }}>
                        {t.authorizedSignatoryName || 'Authorized Signatory'}
                      </div>
                      {t.authorizedSignatoryDesignation && (
                        <div style={{ fontSize: '9px', color: '#64748b' }}>
                          {t.authorizedSignatoryDesignation}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer Text */}
                  {t.footerText && (
                    <div style={{ textAlign: 'center', fontSize: '9.5px', color: '#64748b', borderTop: '1px solid #e2e8f0', paddingTop: '8px', marginTop: '16px' }}>
                      {t.footerText}
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Version History Modal */}
      <Modal
        open={historyModalOpen}
        onClose={() => setShowHistoryModal(false)}
        title={`Version History — ${t.name}`}
        footer={<Button onClick={() => setShowHistoryModal(false)}>Close</Button>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {(t.history || []).map((h, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Version {h.version}</strong>
                <span className="muted" style={{ fontSize: '12px' }}>{formatDateTime(h.savedAt)}</span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--ink-secondary)' }}>
                {h.note || 'Updated configuration'}
              </p>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
