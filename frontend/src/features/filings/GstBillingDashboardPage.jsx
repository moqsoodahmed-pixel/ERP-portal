import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  LoadingState,
  ErrorState,
} from '../../design-system/index.js';
import { formatDateTime } from '../../utils/format.js';

const PROCESSING_STATUS = {
  NONE: { label: 'Awaiting Vendor Processing', tone: 'neutral' },
  IN_PROGRESS: { label: 'Vendor Processing In Progress', tone: 'info' },
  COMPLETED: { label: 'Vendor Processing Completed', tone: 'ok' },
};

export default function GstBillingDashboardPage() {
  const { id } = useParams();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    (async () => {
      try {
        const [profileRes, filingRes, finalDocsRes, matchRes] = await Promise.all([
          api.get('/business-profile').catch((err) => (err.status === 404 ? { data: null } : Promise.reject(err))),
          api.get(`/gst-filings/${id}`),
          api.get(`/gst-filings/${id}/final-documents`),
          api.get(`/gst-filings/${id}/tally-matching`).catch((err) => (err.status === 404 ? { data: null } : Promise.reject(err))),
        ]);
        setState({
          status: 'ready',
          data: {
            profile: profileRes.data, filing: filingRes.data, finalDocuments: finalDocsRes.data.items, match: matchRes.data,
          },
          error: null,
        });
      } catch (err) {
        setState({ status: 'error', data: null, error: err });
      }
    })();
  }, [id]);

  if (state.status === 'loading') return <LoadingState label="Loading GST billing information…" />;
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="GST Billing" />
        <ErrorState error={{ ...state.error, message: state.error?.message ?? 'Unable to load GST billing information.' }} />
      </>
    );
  }

  const {
    profile, filing, finalDocuments, match,
  } = state.data;
  const processing = !match ? PROCESSING_STATUS.NONE : (match.overallStatus === 'FULLY_MATCHED' ? PROCESSING_STATUS.COMPLETED : PROCESSING_STATUS.IN_PROGRESS);

  return (
    <>
      <PageHeader title="GST Billing" subtitle="Vendor-processed GST documents for this filing." />

      <Card style={{ marginBottom: '1.25rem' }}>
        <dl className="definition-list">
          <div><dt>Company</dt><dd>{profile?.displayName ?? 'Not set'}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{profile?.gstin ?? '—'}</dd></div>
          <div><dt>Filing</dt><dd>{filing.periodLabel ?? filing.periodKey} ({filing.returnType?.replace('_', ' ')})</dd></div>
          <div><dt>Status</dt><dd><span className={`badge badge--${processing.tone}`}>{processing.label}</span></dd></div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Vendor Final Documents" />
        <CardBody>
          {finalDocuments.length === 0 && (
            <p className="muted">
              No final document available yet.<br />
              Your GST vendor will upload the final document after completing the processing.
            </p>
          )}
          {finalDocuments.map((d) => (
            <div key={d.id} className="card placeholder" style={{ marginBottom: '.75rem', padding: '1rem 1.25rem' }}>
              <strong style={{ wordBreak: 'break-word', fontSize: '15px' }}>{d.fileName}</strong>
              <p className="muted" style={{ margin: '0.25rem 0 0.75rem 0', fontSize: '13px' }}>
                Uploaded by GST Vendor · {formatDateTime(d.uploadedAt)}
              </p>
              <div className="toolbar toolbar--tight">
                <ViewDownloadButtons filingId={id} docId={d.id} fileName={d.fileName} />
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </>
  );
}

function ViewDownloadButtons({ filingId, docId, fileName }) {
  const [notice, setNotice] = useState(null);

  const fetchBlob = async () => {
    const { blob } = await api.getBlob(`/gst-filings/${filingId}/final-documents/${docId}`);
    return blob;
  };

  const view = async () => {
    try {
      const blob = await fetchBlob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setNotice(err.message ?? `Could not open ${fileName}`);
    }
  };

  const download = async () => {
    try {
      const blob = await fetchBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setNotice(err.message ?? `Could not download ${fileName}`);
    }
  };

  return (
    <>
      <button type="button" className="btn btn--small" onClick={view}>View Document</button>
      <button type="button" className="btn btn--small" onClick={download}>Download</button>
      {notice && <span className="field__error" style={{ marginLeft: '.5rem' }}>{notice}</span>}
    </>
  );
}
