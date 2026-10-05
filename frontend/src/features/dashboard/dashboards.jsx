import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { canAny } from '../../permissions/permissions.js';
import { formatDate, formatMoney } from '../../utils/format.js';

const FILING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'SUBMITTED', 'FILED'];
const PRESETS = [['today', 'Today'], ['this_week', 'This week'], ['this_month', 'This month'], ['previous_month', 'Previous month'], ['this_quarter', 'This quarter'], ['custom', 'Custom range']];

function useFetch(path) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [token, setToken] = useState(0);
  const key = `${path}#${token}`;
  useEffect(() => {
    let live = true;
    api.get(path).then((r) => live && setState({ key, data: r.data, error: null })).catch((error) => live && setState({ key, data: null, error }));
    return () => { live = false; };
  }, [path, key]);
  const status = state.key !== key ? 'loading' : (state.error ? 'error' : 'ready');
  return { status, data: status === 'ready' ? state.data : null, error: state.error, reload: () => setToken((n) => n + 1) };
}

/** Date-window picker shared by dashboards and reports. Bounds are validated server-side (400 on bad ranges). */
export function RangePicker({ value, onChange, allowDefault = false }) {
  const [draft, setDraft] = useState({ from: value.from ?? '', to: value.to ?? '' });
  return (
    <div className="toolbar toolbar--tight" role="group" aria-label="Date range">
      <label className="field field--inline">
        <span className="sr-only">Date range</span>
        <select value={value.range} onChange={(e) => onChange(e.target.value === 'custom' ? { range: 'custom', ...draft } : { range: e.target.value })}>
          {allowDefault && <option value="">Report default period</option>}
          {PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
      </label>
      {value.range === 'custom' && (
        <>
          <label className="field field--inline"><span className="sr-only">From</span><input type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} /></label>
          <label className="field field--inline"><span className="sr-only">To</span><input type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} /></label>
          <button type="button" className="btn" disabled={!draft.from || !draft.to} onClick={() => onChange({ range: 'custom', ...draft })}>Apply</button>
        </>
      )}
    </div>
  );
}

const Stat = ({ value, label }) => <div className="stat"><span className="stat__value">{value}</span><span className="muted">{label}</span></div>;
/** A metric the server marked not applicable is shown as such — never as a zero. */
const NotApplicable = ({ section, label }) => (
  <p className="na">{label}: not available{section?.reason === 'PERMISSION_REQUIRED' ? ' for your account' : ` — ${section?.reason ?? 'no data source'}`}</p>
);
const rangeLabel = (r) => (r ? `${formatDate(r.from)} – ${formatDate(r.to)}` : '');

function FilingPipeline({ pipeline }) {
  return (
    <section className="stat-row" aria-label="GST filing pipeline">
      {FILING_STATUSES.map((s) => <Stat key={s} value={pipeline[s] ?? 0} label={<StatusBadge status={s} />} />)}
    </section>
  );
}

export function MasterDashboard() {
  const [range, setRange] = useState({ range: 'this_month' });
  const { status, data, error, reload } = useFetch(`/master/dashboard${toQuery(range)}`);
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Clients, users, GST filing workflow, Tally sync health and security events across all tenants." />
      <RangePicker value={range} onChange={setRange} />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <>
          <section className="stat-row" aria-label="Clients by status">
            <Stat value={data.clients.total} label="Total clients" />
            <Stat value={data.clients.active} label="Active" />
            <Stat value={data.clients.pending} label="Pending" />
            <Stat value={data.clients.suspended} label="Suspended" />
            <Stat value={data.clients.inactive} label="Inactive" />
          </section>
          <section className="stat-row" aria-label="Users and vendors">
            <Stat value={data.users.total} label="Total users" />
            <Stat value={data.users.active} label="Active users" />
            {data.gstVendors !== null && <Stat value={data.gstVendors} label="GST vendors" />}
            {data.activeVendorAssignments !== null && <Stat value={data.activeVendorAssignments} label="Active vendor assignments" />}
          </section>
          <h2 className="section-title">GST filing workflow (all tenants, current state)</h2>
          <FilingPipeline pipeline={data.gstFilings.pipeline} />
          <section className="stat-row"><Stat value={data.gstFilings.openIssues} label="Open filing issues" /></section>
          <h2 className="section-title">Activity in range <small className="muted">{rangeLabel(data.range)}</small></h2>
          <section className="stat-row" aria-label="Tally and invoices">
            <Stat value={data.tallySync.byStatus.SYNCED} label="Tally syncs succeeded" />
            <Stat value={data.tallySync.byStatus.FAILED} label="Tally syncs failed" />
            <Stat value={data.tallySync.byStatus.RETRYING} label="Tally syncs awaiting retry" />
            <Stat value={data.invoices.byStatus.ISSUED} label="Invoices issued" />
            <Stat value={data.securityEvents.total} label="Security events" />
            <Stat value={data.securityEvents.highOrCritical} label="High / critical events" />
          </section>
        </>
      )}
    </>
  );
}

export function ClientDashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState({ range: 'this_month' });
  const { status, data, error, reload } = useFetch(`/dashboard${toQuery(range)}`);
  const links = [
    ['/client/products', 'Products & services', 'products.view'], ['/client/customers', 'Customers', 'customers.view'],
    ['/client/invoices', 'Invoices', 'invoices.view'], ['/client/gst', 'GST filing progress', 'gst.view'],
    ['/client/gst-filings', 'GST filing workflow tracker', 'gst_filings.view'], ['/client/tally', 'Tally sync status', 'tally.view'],
    ['/client/reports', 'Reports', 'reports.view'],
  ].filter(([, , p]) => canAny(user, [p]));
  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle="Your business workspace." />
      <RangePicker value={range} onChange={setRange} />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <>
          <h2 className="section-title">Invoices <small className="muted">{rangeLabel(data.range)}</small></h2>
          {data.invoices.available ? (
            <>
              <section className="stat-row" aria-label="Invoices by status">
                <Stat value={data.invoices.byStatus.ISSUED} label="Issued" />
                <Stat value={data.invoices.byStatus.DRAFT} label="Draft" />
                <Stat value={data.invoices.byStatus.CANCELLED} label="Cancelled" />
              </section>
              <section className="stat-row" aria-label="Issued invoice totals">
                <Stat value={formatMoney(data.invoices.issued.taxableAmount)} label="Taxable value (issued)" />
                <Stat value={formatMoney(data.invoices.issued.totalGst)} label="Total GST (CGST+SGST+IGST)" />
                <Stat value={formatMoney(data.invoices.issued.grandTotal)} label="Grand total (issued)" />
              </section>
              <NotApplicable section={data.invoices.payments} label="Payments received / outstanding" />
            </>
          ) : <NotApplicable section={data.invoices} label="Invoice metrics" />}
          <section className="stat-row" aria-label="Catalogue">
            {data.customers.available ? <Stat value={data.customers.active} label="Active customers" /> : null}
            {data.products.available ? <Stat value={data.products.active} label="Active products" /> : null}
            {data.tally.available && (
              <>
                <Stat value={data.tally.synced} label="Tally synced (issued in range)" />
                <Stat value={data.tally.failed} label="Tally failed" />
                <Stat value={data.tally.pending} label="Tally pending" />
              </>
            )}
          </section>
          {data.gstFilings.available && (
            <section className="card" aria-label="GST filing summary">
              <h2>GST filing — {data.gstFilings.latestPeriod}</h2>
              <ul className="link-list">
                {data.gstFilings.filings.map((f) => (
                  <li key={f._id}>{f.returnType.replace('_', ' ')}: <StatusBadge status={f.status} /> · {f.progressPercent}% · {f.openIssues} open issue(s)</li>
                ))}
              </ul>
            </section>
          )}
          {!data.gstFilings.available && data.gstFilings.reason !== 'PERMISSION_REQUIRED' && <NotApplicable section={data.gstFilings} label="GST filing summary" />}
        </>
      )}
      <section className="card">
        <ul className="link-list">{links.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
      </section>
    </>
  );
}

export function VendorDashboard() {
  const { status, data, error, reload } = useFetch('/vendors/me/dashboard');
  return (
    <>
      <PageHeader title="Filing desk" subtitle="GST filing workflow across clients currently assigned to you." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <>
          <section className="stat-row">
            <Stat value={data.assignedClients} label="Assigned clients" />
            <Stat value={data.gstFilings.inProgress} label="GST filings in progress" />
            <Stat value={data.gstFilings.openIssues} label="Open filing issues" />
          </section>
          <FilingPipeline pipeline={data.gstFilings.pipeline} />
          <h2 className="section-title">Bill accounting workflow</h2>
          <section className="stat-row" aria-label="Bills by status">
            <Stat value={data.bills.pendingReview} label="Awaiting ERP review" />
            <Stat value={data.bills.byStatus.READY_FOR_TALLY} label="Ready for Tally" />
            <Stat value={data.bills.byStatus.ACCOUNTING_IN_PROGRESS} label="Accounting in progress" />
            <Stat value={data.bills.byStatus.COMPLETED} label="Completed" />
          </section>
          <h2 className="section-title">Tally job queue</h2>
          <section className="stat-row" aria-label="Tally jobs by status">
            <Stat value={data.tallyJobs.byStatus.QUEUED} label="Queued" />
            <Stat value={data.tallyJobs.byStatus.PROCESSING} label="Processing" />
            <Stat value={data.tallyJobs.byStatus.SUCCEEDED} label="Tally job completed" />
            <Stat value={data.tallyJobs.retryable} label="Failed (retryable)" />
          </section>
          <p className="muted">{data.tallyJobs.note}</p>
          {data.clients.length > 0 && (
            <section className="card" aria-label="Per-client filing status">
              <table className="data-table">
                <thead><tr><th>Client</th>{FILING_STATUSES.map((s) => <th key={s}><StatusBadge status={s} /></th>)}<th>Open issues</th></tr></thead>
                <tbody>
                  {data.clients.map((c) => (
                    <tr key={c.tenantId}>
                      <td><Link to={`/vendor/clients/${c.tenantId}`}>{c.businessName}</Link></td>
                      {FILING_STATUSES.map((s) => <td key={s}>{c.pipeline[s]}</td>)}
                      <td>{c.openIssues}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
