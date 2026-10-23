import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, adminTenantHeaders } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, ISSUE_TYPES, ISSUE_SEVERITIES } from './filingsApi.js';

const NEXT_TRANSITION = {
  NOT_STARTED: { action: 'start', label: 'Start work' },
  IN_PROGRESS: { action: 'ready', label: 'Mark ready for review' },
  READY_FOR_REVIEW: { action: 'submit', label: 'Submit' },
  SUBMITTED: { action: 'mark-filed', label: 'Mark as filed' },
};

function ReadinessPanel({ readiness }) {
  return (
    <section className="card">
      <h2>Readiness</h2>
      <p className={readiness.ready ? 'state state--ok' : 'state state--warn'}>
        {readiness.ready ? 'READY' : 'NOT READY'}
      </p>
      {readiness.blockers.length > 0 && (
        <ul className="link-list">{readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
      )}
      <p className="muted"><em>{readiness.label}</em></p>
    </section>
  );
}

function ReconciliationPanel({ reconciliation }) {
  return (
    <section className="card">
      <h2>Invoice &amp; Tally reconciliation ({reconciliation.periodKey})</h2>
      <div className="stat-row">
        <div className="stat"><span className="stat__value">{reconciliation.total}</span><span className="muted">Total invoices</span></div>
        <div className="stat"><span className="stat__value">{reconciliation.issued}</span><span className="muted">Issued</span></div>
        <div className="stat"><span className="stat__value">{reconciliation.cancelled}</span><span className="muted">Cancelled</span></div>
        <div className="stat"><span className="stat__value">{reconciliation.draftExcluded}</span><span className="muted">Draft (excluded)</span></div>
      </div>
      <div className="stat-row">
        <div className="stat"><span className="stat__value">{reconciliation.tally.synced}</span><span className="muted">Tally: Synced</span></div>
        <div className="stat"><span className="stat__value">{reconciliation.tally.failed}</span><span className="muted">Tally: Failed</span></div>
        <div className="stat"><span className="stat__value">{reconciliation.tally.notSynced}</span><span className="muted">Tally: Not synced</span></div>
      </div>
      <p className="muted">Read-only: reconciliation never re-triggers a Tally sync; it only reads already-recorded sync results.</p>
    </section>
  );
}

function MilestonesPanel({ filing, canEdit, onSave }) {
  const [milestones, setMilestones] = useState(filing.milestones);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(milestones) !== JSON.stringify(filing.milestones);
  const setStatus = (key, value) => setMilestones((ms) => ms.map((m) => (m.key === key ? { ...m, status: value } : m)));
  return (
    <section className="card">
      <h2>Milestones ({filing.progressPercent}% complete)</h2>
      <ul className="link-list">
        {[...milestones].sort((a, b) => a.order - b.order).map((m) => (
          <li key={m.key}>
            <strong>{m.label}</strong>{' '}
            {canEdit ? (
              <select value={m.status} onChange={(e) => setStatus(m.key, e.target.value)}>
                <option value="PENDING">Pending</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="DONE">Done</option>
              </select>
            ) : <StatusBadge status={m.status} />}
          </li>
        ))}
      </ul>
      {canEdit && (
        <button type="button" className="btn" disabled={!dirty || busy} onClick={async () => { setBusy(true); try { await onSave({ milestones }); } finally { setBusy(false); } }}>
          Save milestone progress
        </button>
      )}
    </section>
  );
}

function SubmissionInfoForm({ filing, canEdit, onSave }) {
  const [form, setForm] = useState({
    acknowledgementNumber: filing.submissionInfo?.acknowledgementNumber ?? '',
    referenceNumber: filing.submissionInfo?.referenceNumber ?? '',
    notes: filing.submissionInfo?.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2>Submission info <span className="badge badge--neutral">Manually recorded</span></h2>
      <p className="muted">
        This is recorded after filing outside this system. It is NEVER verified against
        a government system — there is no GST portal integration in this product.
      </p>
      <dl className="definition-list">
        <div><dt>Source</dt><dd>{filing.submissionInfo?.source ?? 'MANUALLY_RECORDED'}</dd></div>
        <div><dt>Submitted at</dt><dd>{filing.submittedAt ? formatDateTime(filing.submittedAt) : '—'}</dd></div>
      </dl>
      {canEdit ? (
        <form className="card" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSave({ submissionInfo: form }); } finally { setBusy(false); } }}>
          <label className="field"><span>Acknowledgement number (manually recorded)</span>
            <input value={form.acknowledgementNumber} onChange={(e) => setForm((f) => ({ ...f, acknowledgementNumber: e.target.value }))} maxLength={100} />
          </label>
          <label className="field"><span>Reference number (manually recorded)</span>
            <input value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} maxLength={100} />
          </label>
          <label className="field"><span>Notes</span>
            <textarea rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} maxLength={2000} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>Save submission info</button>
        </form>
      ) : (
        <dl className="definition-list">
          <div><dt>Acknowledgement number</dt><dd>{filing.submissionInfo?.acknowledgementNumber ?? '—'}</dd></div>
          <div><dt>Reference number</dt><dd>{filing.submissionInfo?.referenceNumber ?? '—'}</dd></div>
        </dl>
      )}
    </section>
  );
}

function IssuesPanel({ filingId, issues, canCreate, canResolve, onChanged, reqOpts }) {
  const [form, setForm] = useState({ type: 'OTHER', severity: 'MEDIUM', title: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(null); // issueId
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState(null);

  const createIssue = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/gst-filings/${filingId}/issues`, form, reqOpts);
      setForm({ type: 'OTHER', severity: 'MEDIUM', title: '', description: '' });
      await onChanged();
    } catch (err) { setError(err.message ?? 'Could not create issue'); } finally { setBusy(false); }
  };
  const updateIssue = async (issueId, patch) => {
    setBusy(true); setError(null);
    try { await api.patch(`/gst-filings/${filingId}/issues/${issueId}`, patch, reqOpts); setResolving(null); setResolution(''); await onChanged(); } catch (err) { setError(err.message ?? 'Could not update issue'); } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Issues</h2>
      {error && <p className="state state--error" role="alert">{error}</p>}
      {issues.length === 0 && <EmptyState title="No issues raised" />}
      {issues.length > 0 && (
        <table className="data-table">
          <thead><tr><th>Type</th><th>Severity</th><th>Title</th><th>Status</th><th /></tr></thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i._id}>
                <td>{i.type.replaceAll('_', ' ')}</td>
                <td><StatusBadge status={i.severity} /></td>
                <td>{i.title}</td>
                <td><StatusBadge status={i.status} /></td>
                <td>
                  {canResolve && (i.status === 'OPEN' || i.status === 'IN_PROGRESS') && (
                    resolving === i._id ? (
                      <span className="toolbar">
                        <input placeholder="Resolution (required)" value={resolution} onChange={(e) => setResolution(e.target.value)} />
                        <button type="button" className="btn btn--primary" disabled={busy || !resolution.trim()} onClick={() => updateIssue(i._id, { status: 'RESOLVED', resolution })}>Resolve</button>
                        <button type="button" className="btn" onClick={() => setResolving(null)}>Cancel</button>
                      </span>
                    ) : <button type="button" className="btn" onClick={() => setResolving(i._id)}>Resolve</button>
                  )}
                  {canResolve && i.status === 'RESOLVED' && (
                    <button type="button" className="btn" disabled={busy} onClick={() => updateIssue(i._id, { status: 'CLOSED' })}>Close</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canCreate && (
        <form className="toolbar" onSubmit={createIssue}>
          <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            {ISSUE_TYPES.map((t) => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}
          </select>
          <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
            {ISSUE_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Title" required maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <input placeholder="Description (optional)" maxLength={2000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          <button type="submit" className="btn btn--primary" disabled={busy || !form.title.trim()}>Raise issue</button>
        </form>
      )}
    </section>
  );
}

export default function FilingDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Master Admin only: the admin-tenant-context header, carried through from the list page's link
  // (never trusted on the server as sole authority — resolveTenantForFiling re-derives the tenant from the
  // filing record itself and only uses this header to decide which tenant's filing the request may act on).
  const adminTenantId = searchParams.get('tenantId');
  const reqOpts = adminTenantId ? adminTenantHeaders(adminTenantId) : undefined;
  const { status, data: filing, error, reload } = useFetch(`/gst-filings/${id}`, [adminTenantId], reqOpts);
  const { data: issues, reload: reloadIssues } = useFetch(filing ? `/gst-filings/${id}/issues` : null, [Boolean(filing), adminTenantId], reqOpts);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState error={error} onRetry={reload} />;

  const canUpdate = can(user, 'gst_filings.update');
  const canSubmit = can(user, 'gst_filings.submit');
  const canMarkFiled = can(user, 'gst_filings.mark_filed');
  const canIssueView = can(user, 'gst_filing_issues.view');
  const canIssueCreate = can(user, 'gst_filing_issues.create');
  const canIssueResolve = can(user, 'gst_filing_issues.resolve');

  const next = NEXT_TRANSITION[filing.status];
  const nextAllowed = next && (
    (next.action === 'submit' && canSubmit) || (next.action === 'mark-filed' && canMarkFiled) || (next.action !== 'submit' && next.action !== 'mark-filed' && canUpdate)
  );

  const runTransition = async () => {
    setBusy(true); setNotice(null);
    try { await api.post(`/gst-filings/${id}/${next.action}`, undefined, reqOpts); await reload(); setNotice(`Transitioned to ${NEXT_TRANSITION[filing.status]?.label ?? 'next stage'}.`); } catch (err) { setNotice(err.message ?? 'Transition failed'); } finally { setBusy(false); }
  };
  const saveFields = async (patch) => { await api.patch(`/gst-filings/${id}`, patch, reqOpts); await reload(); };

  return (
    <>
      <PageHeader
        title={`${filing.periodLabel ?? filing.periodKey} — ${filing.returnType.replace('_', ' ')}`}
        subtitle="ERP-internal GST filing workflow tracker. This is not a government portal — no figures here are a verified filing acknowledgement unless explicitly marked manually recorded."
        actions={<StatusBadge status={filing.status} />}
      />
      {notice && <p className="state" role="status">{notice}</p>}
      {can(user, 'gst_bills.view') && location.pathname.startsWith('/client/') && (
        <section className="card">
          <div className="toolbar toolbar--tight">
            <Link to={`${location.pathname}/bill`} className="btn btn--primary">Open Bill Builder</Link>
            <Link to={`${location.pathname}/billing`} className="btn">Open GST Billing Dashboard</Link>
          </div>
        </section>
      )}
      {next && nextAllowed && (
        <section className="card">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={runTransition}>{next.label}</button>
        </section>
      )}

      <ReadinessPanel readiness={filing.readiness} />
      <MilestonesPanel filing={filing} canEdit={canUpdate} onSave={saveFields} />
      <ReconciliationPanel reconciliation={filing.reconciliation} />
      <SubmissionInfoForm filing={filing} canEdit={canUpdate} onSave={saveFields} />

      {canIssueView && (
        <IssuesPanel
          filingId={id}
          issues={issues?.items ? issues.items : (Array.isArray(issues) ? issues : [])}
          canCreate={canIssueCreate}
          canResolve={canIssueResolve}
          reqOpts={reqOpts}
          onChanged={async () => { await reloadIssues(); await reload(); }}
        />
      )}

      <section className="card">
        <h2>History</h2>
        {(!filing.history || filing.history.length === 0) && <EmptyState title="No status changes yet" />}
        {filing.history?.length > 0 && (
          <table className="data-table">
            <thead><tr><th>From</th><th>To</th><th>When</th></tr></thead>
            <tbody>
              {filing.history.map((h, idx) => (
                <tr key={idx}><td>{h.previousStatus ?? '—'}</td><td>{h.newStatus}</td><td>{formatDateTime(h.timestamp)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {filing.dueDate && <p className="muted">Due date: {formatDate(filing.dueDate)} (planning aid only — not a verified statutory deadline).</p>}
    </>
  );
}
