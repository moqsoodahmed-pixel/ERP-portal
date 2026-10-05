import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import ListPage from '../../components/ListPage.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';

function useFetch(path, deps = []) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let live = true;
    api.get(path).then((r) => live && setState({ status: 'ready', data: r.data, error: null }))
      .catch((error) => live && setState({ status: 'error', data: null, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadToken, ...deps]);
  return { ...state, reload: () => setReloadToken((t) => t + 1) };
}

/** ---- Master Admin: vendor list ---- */
export function VendorsAdminPage() {
  return (
    <ListPage
      title="GST vendors" subtitle="Filing partners and their client assignments." path="/vendors"
      columns={[
        { key: 'vendorCode', header: 'Code', mono: true },
        { key: 'name', header: 'Vendor', render: (r) => <Link to={`/master/vendors/${r._id}`}>{r.name}</Link> },
        { key: 'contactEmail', header: 'Contact' },
        { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]}
      searchPlaceholder="Search vendors" emptyTitle="No vendors yet" emptyHint="Create a vendor to get started."
      actions={<Link className="btn btn--primary" to="/master/vendors/new">New vendor</Link>}
    />
  );
}

export function CreateVendorPage() {
  const [form, setForm] = useState({ name: '', contactEmail: '', phone: '', user: { name: '', email: '', password: '' } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post('/vendors', form);
      window.location.assign(`/master/vendors/${res.data.vendor._id}`);
    } catch (err) {
      setError(err.message ?? 'Could not create vendor');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="New GST vendor" subtitle="Creates a filing-partner organisation and its login user." />
      <form className="card" onSubmit={submit}>
        <label className="field"><span>Vendor name</span><input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label>
        <label className="field"><span>Contact email</span><input type="email" required value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} /></label>
        <label className="field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></label>
        <h2>Login user</h2>
        <label className="field"><span>Name</span><input required value={form.user.name} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, name: e.target.value } }))} /></label>
        <label className="field"><span>Email</span><input type="email" required value={form.user.email} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, email: e.target.value } }))} /></label>
        <label className="field"><span>Temporary password</span><input type="password" required minLength={12} value={form.user.password} onChange={(e) => setForm((f) => ({ ...f, user: { ...f.user, password: e.target.value } }))} /></label>
        {error && <p className="state state--error" role="alert">{error}</p>}
        <div className="dialog__actions"><button type="submit" className="btn btn--primary" disabled={busy}>Create vendor</button></div>
      </form>
    </>
  );
}

/** ---- Master Admin: vendor detail + assignment lifecycle ---- */
export function VendorDetailPage() {
  const { vendorId } = useParams();
  const { status, data, error, reload } = useFetch(`/vendors/${vendorId}`);
  const [assignTenantId, setAssignTenantId] = useState('');
  const [lifecycle, setLifecycle] = useState(null); // { assignmentId, action }
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState error={error} onRetry={reload} />;
  const { vendor, assignments } = data;

  const assign = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/vendors/${vendorId}/assignments`, { tenantId: assignTenantId });
      setAssignTenantId(''); setNotice('Client assigned.'); await reload();
    } catch (err) {
      setNotice(err.message ?? 'Assignment failed');
    } finally { setBusy(false); }
  };

  const runLifecycle = async () => {
    setBusy(true);
    try {
      await api.patch(`/vendors/${vendorId}/assignments/${lifecycle.assignmentId}`, {
        action: lifecycle.action, reason: lifecycle.action === 'deactivate' ? reason : undefined,
      });
      setLifecycle(null); setReason('');
      setNotice(lifecycle.action === 'deactivate' ? 'Assignment deactivated.' : 'Assignment reactivated.');
      await reload();
    } catch (err) {
      setNotice(err.message ?? 'Update failed');
    } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title={vendor.name} subtitle={`${vendor.vendorCode} · ${vendor.contactEmail ?? ''}`} actions={<StatusBadge status={vendor.status} />} />
      {notice && <p className="state" role="status">{notice}</p>}

      <section className="card">
        <h2>Assign a new client</h2>
        <form className="toolbar" onSubmit={assign}>
          <label className="field field--inline">
            <span className="sr-only">Tenant id</span>
            <input placeholder="Client (tenant) id" required value={assignTenantId} onChange={(e) => setAssignTenantId(e.target.value)} />
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy}>Assign</button>
        </form>
      </section>

      <section className="card">
        <h2>Assignment history</h2>
        {assignments.length === 0 && <EmptyState title="No assignments yet" />}
        {assignments.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Tenant</th><th>Status</th><th>Assigned</th><th>Deactivated</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a._id}>
                  <td className="mono">{a.tenantId}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{formatDate(a.assignedAt)}</td>
                  <td>{a.unassignedAt ? formatDate(a.unassignedAt) : '—'}</td>
                  <td>{a.deactivationReason ?? '—'}</td>
                  <td>
                    {a.status === 'ACTIVE' && <button type="button" className="btn btn--danger" onClick={() => setLifecycle({ assignmentId: a._id, action: 'deactivate' })}>Deactivate</button>}
                    {a.status === 'INACTIVE' && <button type="button" className="btn" onClick={() => setLifecycle({ assignmentId: a._id, action: 'reactivate' })}>Reactivate</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {lifecycle?.action === 'deactivate' && (
        <div className="overlay">
          <form className="dialog" onSubmit={(e) => { e.preventDefault(); runLifecycle(); }}>
            <h2>Deactivate assignment</h2>
            <label className="field"><span>Reason (required)</span><textarea required minLength={1} maxLength={500} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <div className="dialog__actions">
              <button type="button" className="btn" onClick={() => setLifecycle(null)}>Cancel</button>
              <button type="submit" className="btn btn--danger" disabled={busy || !reason.trim()}>Deactivate</button>
            </div>
          </form>
        </div>
      )}
      {lifecycle?.action === 'reactivate' && (
        <ConfirmDialog open title="Reactivate this assignment?" message="The vendor will immediately regain access to this client's data."
          confirmLabel="Reactivate" onConfirm={runLifecycle} onCancel={() => setLifecycle(null)} />
      )}
    </>
  );
}

/** ---- Client Admin: read-only visibility of vendor(s) assigned to THEIR OWN tenant ---- */
export function ClientGstVendorPage() {
  const { user } = useAuth();
  // The tenantId in the path is never trusted as authoritative by the server (it re-derives the caller's
  // own tenant from the authenticated session either way) — it is included here only to match the REST shape.
  const { status, data, error, reload } = useFetch(`/clients/${user.tenantId}/vendors`);
  return (
    <>
      <PageHeader title="GST vendor" subtitle="Filing partner(s) assigned to your account by the platform administrator." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && data.length === 0 && <EmptyState title="No vendor assigned" hint="Contact your platform administrator to assign a GST filing partner." />}
      {status === 'ready' && data.length > 0 && (
        <section className="card">
          <table className="data-table">
            <thead><tr><th>Vendor</th><th>Email</th><th>Status</th><th>Assigned on</th></tr></thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.assignmentId}>
                  <td>{a.vendor?.name ?? '—'}</td>
                  <td>{a.vendor?.contactEmail ?? '—'}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td>{formatDate(a.assignedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

/** ---- Vendor portal: assigned clients ---- */
export function VendorClientsPage() {
  const { status, data, error, reload } = useFetch('/vendors/me/clients');
  return (
    <>
      <PageHeader title="Assigned clients" subtitle="Clients explicitly assigned to you by the platform administrator." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && data.length === 0 && <EmptyState title="No clients assigned yet" />}
      {status === 'ready' && data.length > 0 && (
        <section className="card">
          <ul className="link-list">
            {data.map((t) => <li key={t.id}><Link to={`/vendor/clients/${t.id}`}>{t.businessName}</Link> <span className="muted">({t.tenantCode})</span></li>)}
          </ul>
        </section>
      )}
    </>
  );
}

/** ---- Vendor portal: one assigned client's invoices (re-verified server-side on every request) ---- */
export function VendorClientDetailPage() {
  const { tenantId } = useParams();
  const { status, data, error, reload } = useFetch(`/vendors/me/clients/${tenantId}/invoices`);
  // Phase 18 — client accounting workspace: bills (Phase 15), Tally queue (Phase 16) and GST filing
  // workflow (Phase 8) for THIS ONE assigned client, each re-verified server-side against the vendor's
  // own active assignment via the `client`/`clientId` query-param narrowing (never trusted bare).
  const billsReq = useFetch(`/bills?client=${tenantId}&limit=10&sort=-updatedAt`);
  const tallyReq = useFetch(`/tally/queue?clientId=${tenantId}&limit=10`);
  const filingsReq = useFetch(`/gst-filings?client=${tenantId}&limit=10&sort=-periodKey`);

  return (
    <>
      <PageHeader title="Client workspace" subtitle="Read-only. Access is re-checked against your active assignment on every request." />

      <section className="card" aria-label="Bills">
        <h2>Bills (accounting workflow)</h2>
        {billsReq.status === 'loading' && <LoadingState />}
        {billsReq.status === 'error' && <ErrorState error={billsReq.error} onRetry={billsReq.reload} />}
        {billsReq.status === 'ready' && billsReq.data.items.length === 0 && <EmptyState title="No bills yet" />}
        {billsReq.status === 'ready' && billsReq.data.items.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Bill #</th><th>Status</th><th>Tally status</th><th>Updated</th></tr></thead>
            <tbody>
              {billsReq.data.items.map((b) => (
                <tr key={b._id}>
                  <td><Link to={`/vendor/bills/${b._id}`}>{b.billNumber ?? '(no number yet)'}</Link></td>
                  <td><StatusBadge status={b.status} /></td>
                  <td><StatusBadge status={b.tallyStatus} /></td>
                  <td>{formatDateTime(b.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">Bill statuses are this ERP&apos;s own internal workflow tracker, not a Tally or government confirmation.</p>
      </section>

      <section className="card" aria-label="Tally queue">
        <h2>Tally queue</h2>
        {tallyReq.status === 'loading' && <LoadingState />}
        {tallyReq.status === 'error' && <ErrorState error={tallyReq.error} onRetry={tallyReq.reload} />}
        {tallyReq.status === 'ready' && tallyReq.data.items.length === 0 && <EmptyState title="Nothing queued" />}
        {tallyReq.status === 'ready' && tallyReq.data.items.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Bill #</th><th>Tally status</th><th>Last attempt</th></tr></thead>
            <tbody>
              {tallyReq.data.items.map((b) => (
                <tr key={b.id}>
                  <td><Link to={`/vendor/bills/${b.id}`}>{b.billNumber ?? '(no number yet)'}</Link></td>
                  <td><StatusBadge status={b.tallyStatus} /></td>
                  <td>{b.lastSyncAttemptAt ? formatDateTime(b.lastSyncAttemptAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">&quot;SYNCED&quot; reflects the connector&apos;s own reported result — awaiting Tally validation, never a confirmed real-world TallyPrime entry in this environment.</p>
      </section>

      <section className="card" aria-label="GST filings">
        <h2>GST filing workflow</h2>
        {filingsReq.status === 'loading' && <LoadingState />}
        {filingsReq.status === 'error' && <ErrorState error={filingsReq.error} onRetry={filingsReq.reload} />}
        {filingsReq.status === 'ready' && filingsReq.data.items.length === 0 && <EmptyState title="No filings yet" />}
        {filingsReq.status === 'ready' && filingsReq.data.items.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Period</th><th>Return type</th><th>Status</th><th>Progress</th></tr></thead>
            <tbody>
              {filingsReq.data.items.map((f) => (
                <tr key={f._id}>
                  <td>{f.periodKey}</td>
                  <td>{f.returnType?.replace('_', ' ')}</td>
                  <td><Link to={`/vendor/filings/${f._id}`}><StatusBadge status={f.status} /></Link></td>
                  <td>{f.progressPercent ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">Internal workflow state only — there is no real GSTN/government filing integration in this platform.</p>
      </section>

      <section className="card" aria-label="Invoices">
        <h2>Invoices</h2>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.items.length === 0 && <EmptyState title="No invoices yet" />}
        {status === 'ready' && data.items.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th>Payment</th><th>Total</th></tr></thead>
            <tbody>
              {data.items.map((inv) => (
                <tr key={inv._id}>
                  <td><Link to={`/vendor/invoices/${inv._id}`} className="mono">{inv.invoiceNumber}</Link></td>
                  <td>{formatDate(inv.invoiceDate)}</td>
                  <td><StatusBadge status={inv.invoiceStatus} /></td>
                  <td><StatusBadge status={inv.paymentStatus} /></td>
                  <td>{inv.grandTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

export function VendorInvoiceDetailPage() {
  const { id } = useParams();
  const { status, data, error, reload } = useFetch(`/invoices/${id}`);
  return (
    <>
      <PageHeader title={data ? `Invoice ${data.invoiceNumber}` : 'Invoice'} subtitle="View-only. No edit, issue, cancel or sync actions are available to a GST vendor." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <section className="card">
          <dl className="definition-list">
            <div><dt>Status</dt><dd><StatusBadge status={data.invoiceStatus} /></dd></div>
            <div><dt>Payment</dt><dd><StatusBadge status={data.paymentStatus} /></dd></div>
            <div><dt>Date</dt><dd>{formatDateTime(data.invoiceDate)}</dd></div>
            <div><dt>Grand total</dt><dd>{data.grandTotal}</dd></div>
          </dl>
          <div className="toolbar">
            <a className="btn" href={`${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/invoices/${id}/pdf`} target="_blank" rel="noreferrer">View PDF</a>
          </div>
        </section>
      )}
    </>
  );
}

