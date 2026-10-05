import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';

const STATUS_ACTIONS = [
  { to: 'ACTIVE', label: 'Activate', needsReason: false, danger: false },
  { to: 'SUSPENDED', label: 'Suspend', needsReason: true, danger: true },
  { to: 'INACTIVE', label: 'Deactivate', needsReason: true, danger: true },
];

/** Loads the tenant record together with its per-client summary. */
function useClientDetails(id) {
  const [state, setState] = useState({ status: 'loading', tenant: null, summary: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([api.get(`/clients/${id}`), api.get(`/clients/${id}/summary`)])
      .then(([tenantRes, summaryRes]) => { if (live) setState({ status: 'ready', tenant: tenantRes.data, summary: summaryRes.data, error: null }); })
      .catch((error) => { if (live) setState({ status: 'error', tenant: null, summary: null, error }); });
    return () => { live = false; };
  }, [id, reloadToken]);

  return { ...state, reload: () => setReloadToken((t) => t + 1) };
}

export default function ClientDetailsPage() {
  const { id } = useParams();
  const { status, tenant, summary, error, reload: load } = useClientDetails(id);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const [pendingStatus, setPendingStatus] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState error={error} onRetry={load} />;

  const startEdit = () => {
    setEdit({
      businessName: tenant.businessName ?? '', legalName: tenant.legalName ?? '', gstin: tenant.gstin ?? '', pan: tenant.pan ?? '',
      email: tenant.email ?? '', phone: tenant.phone ?? '',
    });
    setEditing(true);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch(`/clients/${id}`, edit);
      setEditing(false);
      setNotice('Client updated.');
      await load();
    } catch (err) {
      setNotice(err.message ?? 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const applyStatus = async () => {
    setBusy(true);
    try {
      await api.patch(`/clients/${id}/status`, { status: pendingStatus.to, reason: pendingStatus.needsReason ? reason : undefined });
      setPendingStatus(null);
      setReason('');
      setNotice(`Client ${pendingStatus.label.toLowerCase()}d.`);
      await load();
    } catch (err) {
      setNotice(err.message ?? 'Status change failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={tenant.businessName}
        subtitle={`${tenant.tenantCode} · Created ${formatDate(tenant.createdAt)} · Last updated ${formatDate(tenant.updatedAt)}`}
        actions={(
          <div className="toolbar">
            <StatusBadge status={tenant.status} />
            <button type="button" className="btn" onClick={startEdit}>Edit</button>
            {STATUS_ACTIONS.filter((a) => a.to !== tenant.status).map((a) => (
              <button key={a.to} type="button" className={`btn ${a.danger ? 'btn--danger' : ''}`} onClick={() => { setPendingStatus(a); setReason(''); }}>{a.label}</button>
            ))}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}

      <section className="card">
        <h2>Business profile</h2>
        <dl className="definition-list">
          <div><dt>Legal name</dt><dd>{tenant.legalName ?? '—'}</dd></div>
          <div><dt>GSTIN</dt><dd className="mono">{tenant.gstin ?? '—'}</dd></div>
          <div><dt>PAN</dt><dd className="mono">{tenant.pan ?? '—'}</dd></div>
          <div><dt>Email</dt><dd>{tenant.email ?? '—'}</dd></div>
          <div><dt>Phone</dt><dd>{tenant.phone ?? '—'}</dd></div>
          <div><dt>Address</dt><dd>{[tenant.address?.line1, tenant.address?.city, tenant.address?.state, tenant.address?.pincode].filter(Boolean).join(', ') || '—'}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>Users</h2>
        <div className="stat-row">
          <div className="stat"><span className="stat__value">{summary.users.total}</span><span className="muted">Total</span></div>
          <div className="stat"><span className="stat__value">{summary.users.active}</span><span className="muted">Active</span></div>
          <div className="stat"><span className="stat__value">{summary.users.pending}</span><span className="muted">Pending</span></div>
          <div className="stat"><span className="stat__value">{summary.users.suspended}</span><span className="muted">Suspended</span></div>
          {summary.activeVendorAssignments !== null && summary.activeVendorAssignments !== undefined && (
            <div className="stat"><span className="stat__value">{summary.activeVendorAssignments}</span><span className="muted">Active vendor assignments</span></div>
          )}
        </div>
      </section>

      {editing && (
        <div className="overlay">
          <form className="dialog" onSubmit={saveEdit}>
            <h2>Edit client</h2>
            <label className="field"><span>Business name</span><input value={edit.businessName} onChange={(e) => setEdit((f) => ({ ...f, businessName: e.target.value }))} required /></label>
            <label className="field"><span>Legal name</span><input value={edit.legalName} onChange={(e) => setEdit((f) => ({ ...f, legalName: e.target.value }))} /></label>
            <label className="field"><span>GSTIN</span><input value={edit.gstin} onChange={(e) => setEdit((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))} /></label>
            <label className="field"><span>PAN</span><input value={edit.pan} onChange={(e) => setEdit((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} /></label>
            <label className="field"><span>Email</span><input type="email" value={edit.email} onChange={(e) => setEdit((f) => ({ ...f, email: e.target.value }))} /></label>
            <label className="field"><span>Phone</span><input value={edit.phone} onChange={(e) => setEdit((f) => ({ ...f, phone: e.target.value }))} /></label>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
              <button type="submit" className="btn btn--primary" disabled={busy}>Save</button>
            </div>
          </form>
        </div>
      )}

      {pendingStatus && pendingStatus.needsReason && (
        <div className="overlay">
          <form className="dialog" onSubmit={(e) => { e.preventDefault(); applyStatus(); }}>
            <h2>{pendingStatus.label} {tenant.businessName}?</h2>
            <label className="field">
              <span>Reason (required)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required rows={4} />
            </label>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={() => setPendingStatus(null)}>Cancel</button>
              <button type="submit" className="btn btn--danger" disabled={busy || reason.trim().length < 5}>{pendingStatus.label}</button>
            </div>
          </form>
        </div>
      )}

      {pendingStatus && !pendingStatus.needsReason && (
        <ConfirmDialog
          open title={`${pendingStatus.label} ${tenant.businessName}?`} message="This takes effect immediately." confirmLabel={pendingStatus.label}
          onConfirm={applyStatus} onCancel={() => setPendingStatus(null)}
        />
      )}

      <p className="muted">Full audit history of this client is available under Platform → Audit logs. Last touched {formatDateTime(tenant.updatedAt)}.</p>
    </>
  );
}
