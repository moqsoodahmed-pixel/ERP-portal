import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../../design-system/index.js';
import { useFetch } from '../filings/filingsApi.js';

const PROCESS_STEPS = [
  { icon: '🏢', title: 'Company Details', description: 'Add company information' },
  { icon: '🧾', title: 'Create Bill', description: 'Add products and rates' },
  { icon: '⬆️', title: 'Upload Bill', description: 'Upload client bill' },
  { icon: '🗄️', title: 'Tally Matching', description: 'LauncherDesk verifies with Tally' },
  { icon: '📄', title: 'Final Document', description: 'Receive final document' },
];

const STEP_KEYS = ['companyDetails', 'billCreated', 'billUploaded', 'tallyMatched', 'finalDocument'];
const STEP_LABELS = ['Company', 'Bill', 'Upload', 'Tally', 'Final'];

const STATUS_TONE = {
  'Company Details Pending': 'neutral',
  'Bill Creation Pending': 'neutral',
  'Bill Upload Pending': 'warn',
  'Tally Matching Pending': 'info',
  'Tally Matching Issue': 'bad',
  'Final Document Pending': 'info',
  Completed: 'ok',
};

const formatPeriod = (periodKey) => {
  if (!/^\d{4}-\d{2}$/.test(periodKey ?? '')) return periodKey ?? '—';
  const [y, m] = periodKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const formatReturnType = (returnType) => (returnType ? returnType.replace('_', '-') : '—');
const initials = (name) => (name ? name.trim().slice(0, 1).toUpperCase() : '?');

function ProcessOverview() {
  return (
    <Card style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '18px', margin: '0 0 1rem 0' }}>GST Filing Process</h2>
      <div className="gst-process">
        {PROCESS_STEPS.map((step, i) => (
          <div className="gst-process__step" key={step.title}>
            <span className="gst-process__circle" aria-hidden="true">{step.icon}</span>
            <span className="gst-process__label">Step {i + 1}: {step.title}</span>
            <span className="gst-process__desc">{step.description}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MiniStepper({ item }) {
  return (
    <div className="gst-steps" role="list" aria-label="Filing progress steps">
      {STEP_KEYS.map((key, i) => {
        const done = item.steps[key];
        const isCurrent = !done && i === item.currentStepIndex - 1;
        const isIssue = isCurrent && key === 'tallyMatched' && item.tally && item.tally.overallStatus !== 'FULLY_MATCHED';
        const stateClass = done ? 'is-done' : (isIssue ? 'is-issue' : (isCurrent ? 'is-current' : ''));
        const marker = done ? '✓' : (isIssue ? '⚠' : (isCurrent ? '●' : '○'));
        return (
          <div className={`gst-steps__step ${stateClass}`} role="listitem" key={key}>
            <span className="gst-steps__dot" aria-hidden="true">{marker}</span>
            <span className="gst-steps__label">{STEP_LABELS[i]}</span>
          </div>
        );
      })}
    </div>
  );
}

function FilingCard({ item, logoUrl }) {
  const [docNotice, setDocNotice] = useState(null);

  const openFinalDocument = async () => {
    try {
      const listRes = await api.get(`/gst-filings/${item.filingId}/final-documents`);
      const doc = listRes.data.items[0];
      if (!doc) return;
      const { blob } = await api.getBlob(`/gst-filings/${item.filingId}/final-documents/${doc.id}`);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setDocNotice(err.message ?? 'Could not open the final document');
    }
  };

  const badgeTone = STATUS_TONE[item.status] ?? 'neutral';

  return (
    <Card style={{ marginBottom: '1.25rem' }}>
      <div className="gst-filing-header">
        <div className="gst-filing-company">
          <span className="gst-filing-avatar" aria-hidden="true">
            {logoUrl ? <img src={logoUrl} alt="" /> : initials(item.companyName)}
          </span>
          <div>
            <h2>{item.companyName ?? 'Company details not set'}</h2>
            <p className={`gst-filing-gstin ${item.gstin ? '' : 'is-missing'}`}>
              GSTIN: {item.gstin ?? 'Not provided'}
            </p>
          </div>
        </div>
        <span className={`badge badge--${badgeTone}`}>{item.status}</span>
      </div>

      <dl className="gst-filing-info-grid">
        <div><dt>Filing Period</dt><dd>{formatPeriod(item.periodKey)}</dd></div>
        <div><dt>Return Type</dt><dd>{formatReturnType(item.returnType)}</dd></div>
      </dl>

      <div className="gst-progress-row">
        <span className="muted">Progress</span>
        <strong>{`${item.progressPercent}%`}</strong>
      </div>
      <div className="progress-bar">
        <div
          className={`progress-bar__fill ${item.progressPercent >= 100 ? 'is-complete' : ''}`}
          style={{ width: `${Math.min(100, Math.max(0, item.progressPercent))}%` }}
        />
      </div>

      <MiniStepper item={item} />

      {item.tally && (
        <div className="gst-detail-row">
          <span className="muted">Tally Matching</span>
          <span>
            {item.tally.matchedCount} / {item.tally.totalClientBills} Matched —{' '}
            <strong>{item.tally.overallStatus === 'FULLY_MATCHED' ? 'Fully Matched' : 'Not Completed'}</strong>
          </span>
        </div>
      )}

      <div className="gst-detail-row">
        <span className="muted">Final Document</span>
        <span>
          {item.finalDocumentCount > 0 ? (
            <>
              <strong>Available</strong>{' '}
              <button type="button" className="btn btn--small" onClick={openFinalDocument}>View</button>
            </>
          ) : <strong>Pending</strong>}
        </span>
      </div>
      {docNotice && <p className="field__error">{docNotice}</p>}

      <div className="toolbar toolbar--tight" style={{ marginTop: '.8rem' }}>
        <Link to={`/client/gst-filings/${item.filingId}`} className="btn btn--primary">View Filing</Link>
        {item.status === 'Completed' && (
          <Link to={`/client/gst-filings/${item.filingId}/billing`} className="btn">GST Billing Dashboard</Link>
        )}
      </div>
    </Card>
  );
}

export default function GstPage() {
  const { user } = useAuth();
  const canCreate = can(user, 'gst_filings.create');
  const { status, data, error, reload } = useFetch('/gst-filings/progress');
  const [logoUrl, setLogoUrl] = useState(null);
  const objectUrlRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const { blob } = await api.getBlob('/business-profile/logo');
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setLogoUrl(url);
      } catch { /* no logo uploaded yet — the avatar falls back to initials */ }
    })();
    return () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, []);

  return (
    <>
      <PageHeader
        title="GST Filing"
        subtitle="Manage your GST filing process from company details through Tally matching and final document completion."
        actions={canCreate && <Link to="/client/gst-filings/new" className="btn btn--primary">+ New Filing</Link>}
      />

      <ProcessOverview />

      {status === 'loading' && <LoadingState label="Loading GST filings…" />}
      {status === 'error' && <ErrorState error={{ ...error, message: error?.message ?? 'Unable to load GST filings.' }} onRetry={reload} />}

      {status === 'ready' && (
        <>
          <div className="stat-row" style={{ marginBottom: '1.5rem' }}>
            <div className="stat"><span className="stat__icon" aria-hidden="true">◉</span><span className="stat__value">{data.summary.totalFilings}</span><span className="muted">Total Filings</span></div>
            <div className="stat"><span className="stat__icon" aria-hidden="true">◐</span><span className="stat__value">{data.summary.inProgress}</span><span className="muted">In Progress</span></div>
            <div className="stat"><span className="stat__icon" aria-hidden="true">⇄</span><span className="stat__value">{data.summary.tallyMatched}</span><span className="muted">Tally Matched</span></div>
            <div className="stat"><span className="stat__icon" aria-hidden="true">✓</span><span className="stat__value">{data.summary.completed}</span><span className="muted">Completed</span></div>
          </div>

          <h2 className="section-title">Your GST Filings {data.items.length > 0 && <span className="badge badge--neutral">{data.items.length}</span>}</h2>
          <p className="muted" style={{ marginBottom: '1.25rem' }}>Track the status of each GST filing.</p>

          {data.items.length === 0 && (
            <>
              <EmptyState title="No GST filings yet" hint="Create your first GST filing to start the process." />
              {canCreate && (
                <div className="toolbar" style={{ marginTop: '1rem' }}>
                  <Link to="/client/gst-filings/new" className="btn btn--primary">+ New Filing</Link>
                </div>
              )}
            </>
          )}
          {data.items.map((item) => <FilingCard key={item.filingId} item={item} logoUrl={logoUrl} />)}
        </>
      )}
    </>
  );
}
