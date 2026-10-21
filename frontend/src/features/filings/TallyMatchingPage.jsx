import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  LoadingState,
} from '../../design-system/index.js';
import { formatMoney, formatDateTime } from '../../utils/format.js';

const ALLOWED_FINAL_DOC_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FINAL_DOC_BYTES = 5 * 1024 * 1024;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const SUMMARY_LINE = {
  FULLY_MATCHED: (d) => `${d.matchedCount} / ${d.totalClientBills} Bills Matched — every client bill has a corresponding Tally bill.`,
  PARTIAL_MATCH: (d) => `${d.matchedCount} / ${d.totalClientBills} Bills Matched — ${d.unmatchedCount} bill(s) require attention.`,
  NOT_MATCHED: (d) => `0 / ${d.totalClientBills} Bills Matched.`,
};

function RunButton({ busy, onRun, label = 'Run Tally Match' }) {
  return <button type="button" className="btn btn--primary" disabled={busy} onClick={onRun}>{busy ? 'Running…' : label}</button>;
}

export default function TallyMatchingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canRun = can(user, 'gst_bills.match');
  const canUploadFinal = can(user, 'gst_bills.final_document.upload');
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [busy, setBusy] = useState(false);
  const [finalDocs, setFinalDocs] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadNotice, setUploadNotice] = useState(null);
  const fileInputRef = useRef(null);

  const fetchResult = () => api.get(`/gst-filings/${id}/tally-matching`)
    .then(({ data }) => setState({ status: 'ready', data, error: null }))
    .catch((err) => {
      if (err.status === 404) setState({ status: 'empty', data: null, error: null });
      else setState({ status: 'error', data: null, error: err });
    });

  const fetchFinalDocs = () => api.get(`/gst-filings/${id}/final-documents`)
    .then(({ data }) => setFinalDocs(data.items))
    .catch(() => {});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchResult(); fetchFinalDocs(); }, [id]);

  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/gst-filings/${id}/tally-matching/run`);
      setState({ status: 'ready', data, error: null });
    } catch (err) {
      setState({ status: 'error', data: null, error: err });
    } finally {
      setBusy(false);
    }
  };

  const onUploadFinalDocument = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!ALLOWED_FINAL_DOC_MIME.includes(file.type)) { setUploadNotice('Please upload a PDF, JPEG, PNG or WEBP file.'); return; }
    if (file.size > MAX_FINAL_DOC_BYTES) { setUploadNotice('File must be 5MB or smaller.'); return; }
    setUploadBusy(true);
    setUploadNotice(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const { data } = await api.post(`/gst-filings/${id}/final-document`, {
        documents: [{ fileName: file.name, mimeType: file.type, contentBase64 }],
      });
      setFinalDocs(data.finalDocuments);
      setUploadNotice('Final document uploaded successfully.');
    } catch (err) {
      setUploadNotice(err.message ?? 'Unable to upload final document. Please try again.');
    } finally {
      setUploadBusy(false);
    }
  };

  const viewFinalDocument = async (docId, fileName) => {
    try {
      const { blob } = await api.getBlob(`/gst-filings/${id}/final-documents/${docId}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setUploadNotice(err.message ?? `Could not open ${fileName}`);
    }
  };

  return (
    <>
      <PageHeader
        title="GST Bill Matching"
        subtitle="Bill-by-bill reconciliation between the client's GST bill and Tally."
        actions={(
          <>
            <button type="button" className="btn" onClick={() => navigate('/vendor/gst-bills')}>← Back to GST Filing Bills</button>
            {canRun && state.status === 'ready' && state.data?.overallStatus !== 'TALLY_ERROR' && <RunButton busy={busy} onRun={run} label="Run Tally Match again" />}
          </>
        )}
      />

      {state.status === 'loading' && <LoadingState label="Loading matching result…" />}

      {state.status === 'error' && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <p className="state state--error" role="alert"><strong>TALLY CONNECTION ERROR</strong></p>
          <p className="muted">{state.error?.message ?? 'Unable to retrieve Tally data. Please check the Tally connection and try again.'}</p>
          {canRun && <RunButton busy={busy} onRun={run} label="Retry" />}
        </Card>
      )}

      {state.status === 'empty' && (
        <Card style={{ marginBottom: '1.25rem' }}>
          <p>Tally matching has not been run for this filing yet.</p>
          {canRun ? <RunButton busy={busy} onRun={run} /> : <p className="muted">Ask your assigned GST vendor to run Tally matching.</p>}
        </Card>
      )}

      {state.status === 'ready' && state.data && (
        state.data.overallStatus === 'TALLY_ERROR' ? (
          <Card style={{ marginBottom: '1.25rem' }}>
            <p className="state state--error" role="alert"><strong>TALLY CONNECTION ERROR</strong></p>
            <p>{state.data.errorMessage || 'Unable to retrieve Tally data. Please check the Tally connection and try again.'}</p>
            {canRun && <RunButton busy={busy} onRun={run} label="Retry" />}
          </Card>
        ) : (
          <>
            <Card style={{ marginBottom: '1.25rem' }}>
              <div className="stat-row">
                <div className="stat"><span className="stat__value">{state.data.totalClientBills}</span><span className="muted">Client Bills</span></div>
                <div className="stat"><span className="stat__value">{state.data.totalTallyBills}</span><span className="muted">Tally Bills</span></div>
                <div className="stat"><span className="stat__value">{state.data.matchedCount}</span><span className="muted">Matched</span></div>
                <div className="stat"><span className="stat__value">{state.data.unmatchedCount}</span><span className="muted">Unmatched</span></div>
                <div className="stat"><span className="stat__value">{state.data.extraTallyCount}</span><span className="muted">Extra Tally Bills</span></div>
              </div>
              <p style={{ marginTop: '1.25rem' }}>
                <StatusBadge status={state.data.overallStatus} />{' '}
                <strong>{SUMMARY_LINE[state.data.overallStatus]?.(state.data)}</strong>
              </p>
            </Card>

            <Card style={{ marginBottom: '1.25rem' }}>
              <table className="data-table">
                <thead><tr><th>Client Bill</th><th>Tally Bill</th><th>Status</th><th>Reason</th></tr></thead>
                <tbody>
                  {state.data.results.map((r) => (
                    <tr key={r.serialNo}>
                      <td>Bill {r.serialNo} — {r.productName} ({formatMoney(r.rate)})</td>
                      <td className="mono">{r.tallyVoucherNumber ?? '—'}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card style={{ marginBottom: '1.25rem' }}>
              <CardHeader title="Vendor Final Document" />
              <CardBody>
                {uploadNotice && (
                  <p className={`state ${/success/i.test(uploadNotice) ? 'state--ok' : 'state--error'}`} role="status">{uploadNotice}</p>
                )}

                {finalDocs.length === 0 && <p className="muted">No final document uploaded yet.</p>}
                {finalDocs.map((d) => (
                  <div key={d.id} className="card placeholder" style={{ marginBottom: '.75rem', padding: '1rem 1.25rem' }}>
                    <strong style={{ fontSize: '15px' }}>{d.fileName}</strong>
                    <p className="muted" style={{ margin: '0.25rem 0 0.75rem 0', fontSize: '13px' }}>
                      Uploaded by GST Vendor · {formatDateTime(d.uploadedAt)}
                    </p>
                    <button type="button" className="btn btn--small" onClick={() => viewFinalDocument(d.id, d.fileName)}>View Document</button>
                  </div>
                ))}

                {canUploadFinal && (
                  state.data.overallStatus === 'FULLY_MATCHED' ? (
                    <div className="toolbar toolbar--tight" style={{ marginTop: '1rem' }}>
                      <button type="button" className="btn btn--primary" disabled={uploadBusy} onClick={() => fileInputRef.current?.click()}>
                        {uploadBusy ? 'Uploading…' : 'Upload Final Document'}
                      </button>
                      <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={onUploadFinalDocument} style={{ display: 'none' }} />
                    </div>
                  ) : (
                    <p className="muted" style={{ marginTop: '0.75rem' }}>Upload the final document once this filing is fully matched.</p>
                  )
                )}
              </CardBody>
            </Card>
          </>
        )
      )}
    </>
  );
}
