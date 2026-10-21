import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  Button,
  DefinitionList,
  DefinitionItem,
  LoadingState,
} from '../../design-system/index.js';
import { formatMoney } from '../../utils/format.js';

const GST_RATE = 18;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const blankRow = () => ({ productName: '', rate: '' });

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function previewTotals(rows) {
  const subtotal = rows.reduce((sum, r) => {
    const n = Number(r.rate);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  const gstAmount = Math.round(subtotal * GST_RATE) / 100;
  return { subtotal, gstAmount, grandTotal: subtotal + gstAmount };
}

export default function BillBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState(null);
  const [logoUrl, setLogoUrl] = useState(null);
  const [rows, setRows] = useState([blankRow()]);
  const [documents, setDocuments] = useState([]);
  const [billExists, setBillExists] = useState(false);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: profile } = await api.get('/business-profile').catch((err) => {
          if (err.status === 404) return { data: null };
          throw err;
        });
        setCompany(profile);
        if (profile?.logoFileId) {
          try {
            const { blob } = await api.getBlob('/business-profile/logo');
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            setLogoUrl(url);
          } catch { /* logo preview is best-effort */ }
        }

        const { data: bill } = await api.get(`/gst-filings/${id}/bill`).catch((err) => {
          if (err.status === 404) return { data: null };
          throw err;
        });
        if (bill) {
          setBillExists(true);
          setRows(bill.items?.length ? bill.items.map((it) => ({ productName: it.productName, rate: it.rate })) : [blankRow()]);
          setDocuments(bill.documents ?? []);
        }
      } catch (err) {
        setNotice(err.message ?? 'Unable to load bill. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, [id]);

  const setRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (idx) => setRows((rs) => {
    const next = rs.filter((_, i) => i !== idx);
    return next.length ? next : [blankRow()];
  });

  const totals = previewTotals(rows);

  const validateAndClean = () => {
    const cleaned = rows.filter((r) => r.productName.trim() !== '' || String(r.rate).trim() !== '');
    const rowErrors = {};
    cleaned.forEach((r, idx) => {
      if (!r.productName.trim()) rowErrors[idx] = { ...rowErrors[idx], productName: 'Product name is required.' };
      const n = Number(r.rate);
      if (r.rate === '' || !Number.isFinite(n) || n <= 0) rowErrors[idx] = { ...rowErrors[idx], rate: 'Rate must be greater than 0.' };
    });
    const formError = cleaned.length === 0 ? 'Please add at least one product.' : null;
    return { cleaned, rowErrors, formError };
  };

  const onSave = async () => {
    const { cleaned, rowErrors, formError } = validateAndClean();
    setErrors({ rows: rowErrors, form: formError });
    if (formError || Object.keys(rowErrors).length) return;
    setBusy(true);
    setNotice(null);
    try {
      const { data: bill } = await api.put(`/gst-filings/${id}/bill`, {
        items: cleaned.map((r) => ({ productName: r.productName.trim(), rate: String(r.rate) })),
      });
      setBillExists(true);
      setRows(bill.items.map((it) => ({ productName: it.productName, rate: it.rate })));
      setDocuments(bill.documents ?? []);
      setNotice('Bill saved successfully.');
    } catch (err) {
      setNotice(err.message ?? 'Unable to save bill. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const onFileChosen = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_UPLOAD_MIME.includes(file.type)) { setNotice('Please upload a PDF, JPEG, PNG or WEBP file.'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    if (file.size > MAX_UPLOAD_BYTES) { setNotice('File must be 5MB or smaller.'); if (fileInputRef.current) fileInputRef.current.value = ''; return; }
    setNotice(null);
    setPendingFile(file);
  };

  const cancelPendingFile = () => {
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const confirmUpload = async () => {
    if (!pendingFile) return;
    setUploadBusy(true);
    setNotice(null);
    try {
      const contentBase64 = await fileToBase64(pendingFile);
      const { data: bill } = await api.post(`/gst-filings/${id}/bill/documents`, {
        documents: [{ fileName: pendingFile.name, mimeType: pendingFile.type, contentBase64 }],
      });
      setDocuments(bill.documents ?? []);
      setNotice('Document uploaded.');
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setNotice(err.message ?? 'Upload failed. Please try again.');
    } finally {
      setUploadBusy(false);
    }
  };

  const viewDocument = async (docId, fileName) => {
    try {
      const { blob } = await api.getBlob(`/gst-filings/${id}/bill/documents/${docId}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setNotice(err.message ?? `Could not open ${fileName}`);
    }
  };

  if (loading) return <LoadingState label="Loading bill…" />;

  return (
    <>
      <PageHeader
        title="Create GST Bill"
        subtitle="Billed products and services for this GST filing."
        actions={<Button onClick={() => navigate(`/client/gst-filings/${id}`)}>← Back to filing</Button>}
      />
      {notice && <p className={`state ${/saved|uploaded/i.test(notice) ? 'state--ok' : 'state--error'}`} role="status">{notice}</p>}

      <Card style={{ marginBottom: '1.25rem' }}>
        <div className="logo-upload" style={{ justifyItems: 'start', marginBottom: '1rem' }}>
          <div className="logo-upload__preview" style={{ width: '96px', height: '96px' }}>
            {logoUrl ? <img src={logoUrl} alt="Company logo" /> : <span>No logo</span>}
          </div>
        </div>
        <h2 style={{ margin: '0 0 .2rem' }}>{company?.displayName || 'Company name not set'}</h2>
        {company?.gstin && <p className="muted">GSTIN: {company.gstin}</p>}
        <p className="muted">
          {[company?.address?.line1, company?.address?.city, company?.address?.state, company?.address?.pincode].filter(Boolean).join(', ') || 'Address not set'}
        </p>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Bill items" />
        <CardBody>
          {errors.form && <p className="field__error">{errors.form}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>S.No</th><th>Product Name</th><th>Rate</th></tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>
                      <input
                        value={row.productName}
                        onChange={(e) => setRow(idx, { productName: e.target.value })}
                        placeholder="Enter product"
                        maxLength={200}
                      />
                      {errors.rows?.[idx]?.productName && <span className="field__error">{errors.rows[idx].productName}</span>}
                    </td>
                    <td>
                      <span className="toolbar toolbar--tight">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={row.rate}
                          onChange={(e) => setRow(idx, { rate: e.target.value })}
                          placeholder="Enter rate"
                          style={{ maxWidth: '140px' }}
                        />
                        <button type="button" className="btn btn--small" title="Remove product" aria-label="Remove product" onClick={() => removeRow(idx)}>✕</button>
                      </span>
                      {errors.rows?.[idx]?.rate && <span className="field__error">{errors.rows[idx].rate}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ marginTop: '1rem' }}>
            <Button onClick={addRow}>+ Add Product</Button>
          </div>

          <DefinitionList columns={3} style={{ maxWidth: '420px', marginLeft: 'auto', marginTop: '1rem' }}>
            <DefinitionItem label="Subtotal" value={formatMoney(totals.subtotal)} />
            <DefinitionItem label={`GST @ ${GST_RATE}%`} value={formatMoney(totals.gstAmount)} />
            <DefinitionItem label="Final Total">
              <strong>{formatMoney(totals.grandTotal)}</strong>
            </DefinitionItem>
          </DefinitionList>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Upload Bill" />
        <CardBody>
          {!billExists && <p className="muted">Save the bill before uploading a supporting document.</p>}

          {!pendingFile ? (
            <div className="toolbar toolbar--tight">
              <button type="button" className="btn" disabled={!billExists || uploadBusy} onClick={() => fileInputRef.current?.click()}>
                Choose file
              </button>
            </div>
          ) : (
            <div className="toolbar toolbar--tight">
              <span>Selected: <strong>{pendingFile.name}</strong></span>
              <button type="button" className="btn btn--primary" disabled={uploadBusy} onClick={confirmUpload}>
                {uploadBusy ? 'Uploading…' : 'Upload'}
              </button>
              <button type="button" className="btn" disabled={uploadBusy} onClick={cancelPendingFile}>Cancel</button>
            </div>
          )}
          <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={onFileChosen} style={{ display: 'none' }} />

          {documents.length > 0 && (
            <>
              <p className="muted" style={{ marginTop: '.75rem', marginBottom: '.3rem' }}>Uploaded documents:</p>
              <ul className="link-list">
                {documents.map((d) => (
                  <li key={d.id}>
                    {d.fileName} — <button type="button" className="btn btn--small" onClick={() => viewDocument(d.id, d.fileName)}>View</button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.5rem' }}>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save Bill'}
        </button>
      </div>
    </>
  );
}
