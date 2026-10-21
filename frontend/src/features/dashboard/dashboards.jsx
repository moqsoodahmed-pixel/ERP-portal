import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, toQuery } from '../../services/apiClient.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { canAny } from '../../permissions/permissions.js';
import { formatDate, formatMoney } from '../../utils/format.js';
import {
  IconCalendar,
  IconFileText,
  IconXCircle,
  IconCoins,
  IconPercent,
  IconWallet,
  IconUsers,
  IconCube,
  IconRefresh,
  IconClock,
  IconHourglass,
  IconChevronRight,
  IconInfo,
  IconBuilding,
  IconReceipt,
  SparklineTrend,
  getNavIcon,
} from '../../components/Icons.jsx';
import { DonutChart, DonutLegend, DualBarChart } from '../../design-system/Charts.jsx';
import HeroIllustration from '../../components/HeroIllustration.jsx';

const FILING_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'SUBMITTED', 'FILED'];
const PRESETS = [
  ['today', 'Today'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['previous_month', 'Previous month'],
  ['this_quarter', 'This quarter'],
  ['custom', 'Custom range'],
];

function useFetch(path) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [token, setToken] = useState(0);
  const key = `${path}#${token}`;
  useEffect(() => {
    let live = true;
    api
      .get(path)
      .then((r) => live && setState({ key, data: r.data, error: null }))
      .catch((error) => live && setState({ key, data: null, error }));
    return () => {
      live = false;
    };
  }, [path, key]);
  const status = state.key !== key ? 'loading' : state.error ? 'error' : 'ready';
  return { status, data: status === 'ready' ? state.data : null, error: state.error, reload: () => setToken((n) => n + 1) };
}

/** Date-window picker shared by dashboards and reports. */
export function RangePicker({ value, onChange, allowDefault = false, rangeSubtext = '' }) {
  const [draft, setDraft] = useState({ from: value.from ?? '', to: value.to ?? '' });
  return (
    <div className="range-picker-container" role="group" aria-label="Date range">
      <div className="range-picker-pill">
        <span className="range-picker-icon" aria-hidden="true">
          <IconCalendar width={16} height={16} />
        </span>
        <label className="field field--inline range-picker-label">
          <span className="sr-only">Date range</span>
          <select
            className="range-picker-select"
            value={value.range}
            onChange={(e) =>
              onChange(
                e.target.value === 'custom' ? { range: 'custom', ...draft } : { range: e.target.value }
              )
            }
          >
            {allowDefault && <option value="">Report default period</option>}
            {PRESETS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {rangeSubtext && <div className="range-picker-subtext">{rangeSubtext}</div>}
      {value.range === 'custom' && (
        <div className="range-picker-custom">
          <label className="field field--inline">
            <span className="sr-only">From</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="field field--inline">
            <span className="sr-only">To</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <button
            type="button"
            className="btn btn--small btn--primary"
            disabled={!draft.from || !draft.to}
            onClick={() => onChange({ range: 'custom', ...draft })}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Stat Component.
 * Strict DOM layout requirement for tests:
 * `label` element's `previousSibling` MUST be `<span className="stat__value">{value}</span>`!
 */
const Stat = ({ value, label, tone, icon, badge, sparkline, onClick, kpi }) => {
  const content = (
    <div className={`stat${tone ? ` stat--${tone}` : ''}${kpi ? ' stat--kpi-premium' : ''}`}>
      {icon && <div className={`stat__icon-box stat__icon-box--${tone || 'neutral'}`}>{icon}</div>}
      <div className="stat__content-wrapper">
        <span className="stat__value">{value}</span>
        <span className="muted">{label}</span>
        {kpi && badge && <div className="stat__trend-inline">{badge}</div>}
      </div>
      {sparkline && <div className="stat__sparkline">{sparkline}</div>}
      {!kpi && badge && <div className="stat__badge">{badge}</div>}
      {onClick && <span className="stat__chevron"><IconChevronRight width={16} height={16} /></span>}
    </div>
  );

  return onClick ? <div className="stat-card-clickable" onClick={onClick} role="button" tabIndex={0}>{content}</div> : content;
};

/** A metric the server marked not applicable is shown as such — never as a zero. */
const NotApplicable = ({ section, label }) => (
  <div className="alert-notice alert-notice--info" role="status">
    <span className="alert-notice__icon" aria-hidden="true">
      <IconInfo width={18} height={18} />
    </span>
    <div className="alert-notice__text">
      <strong>{label}: not available</strong>
      <span>
        {section?.reason === 'PERMISSION_REQUIRED'
          ? ' for your account'
          : ` — ${section?.reason ?? 'no data source'}`}
      </span>
    </div>
  </div>
);

const rangeLabel = (r) => (r ? `${formatDate(r.from)} – ${formatDate(r.to)}` : '');

/** Decorative palette for the invoice-status donut (purely presentational — the legend's text labels,
 * not color, are what convey Issued/Draft/Cancelled meaning; status badges elsewhere keep their usual
 * semantic green/amber/red). */
const invoiceStatusSlices = (data) => [
  { label: 'Issued', value: data.invoices.byStatus.ISSUED, color: '#3B82F6' },
  { label: 'Draft', value: data.invoices.byStatus.DRAFT, color: '#F59E0B' },
  { label: 'Cancelled', value: data.invoices.byStatus.CANCELLED, color: '#EC4899' },
];

function FilingPipeline({ pipeline }) {
  return (
    <section className="stat-row stat-row--pipeline" aria-label="GST filing pipeline">
      {FILING_STATUSES.map((s) => (
        <Stat key={s} value={pipeline[s] ?? 0} label={<StatusBadge status={s} />} />
      ))}
    </section>
  );
}

export function MasterDashboard() {
  const [range, setRange] = useState({ range: 'this_month' });
  const { status, data, error, reload } = useFetch(`/master/dashboard${toQuery(range)}`);

  return (
    <div className="dashboard-container">
      <div className="welcome-banner">
        <HeroIllustration className="welcome-banner__illustration" />
        <div className="welcome-banner__content">
          <div className="welcome-banner__title-area">
            <h1 className="welcome-banner__title">Platform overview</h1>
            <p className="welcome-banner__subtitle">
              Clients, users, GST filing workflow, Tally sync health and security events across all tenants.
            </p>
          </div>
          <div className="welcome-banner__actions">
            <RangePicker
              value={range}
              onChange={setRange}
              rangeSubtext={data?.range ? `Range ${rangeLabel(data.range)}` : ''}
            />
          </div>
        </div>
      </div>

      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && (
        <>
          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">Clients</h2>
            </div>
            <section className="stat-row" aria-label="Clients by status">
              <Stat value={data.clients.total} label="Total clients" icon={<IconBuilding />} />
              <Stat value={data.clients.active} label="Active" tone="ok" icon={<IconBuilding />} />
              <Stat value={data.clients.pending} label="Pending" tone="warn" icon={<IconClock />} />
              <Stat value={data.clients.suspended} label="Suspended" tone="bad" icon={<IconXCircle />} />
              <Stat value={data.clients.inactive} label="Inactive" icon={<IconBuilding />} />
            </section>
          </div>

          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">Users &amp; vendors</h2>
            </div>
            <section className="stat-row" aria-label="Users and vendors">
              <Stat value={data.users.total} label="Total users" icon={<IconUsers />} />
              <Stat value={data.users.active} label="Active users" tone="ok" icon={<IconUsers />} />
              {data.gstVendors !== null && (
                <Stat value={data.gstVendors} label="GST vendors" icon={<IconBuilding />} />
              )}
              {data.activeVendorAssignments !== null && (
                <Stat value={data.activeVendorAssignments} label="Active vendor assignments" icon={<IconUsers />} />
              )}
            </section>
          </div>

          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">GST filing workflow (all tenants, current state)</h2>
            </div>
            <FilingPipeline pipeline={data.gstFilings.pipeline} />
            <section className="stat-row stat-row--tight" style={{ marginTop: '12px' }}>
              <Stat
                value={data.gstFilings.openIssues}
                label="Open filing issues"
                tone={data.gstFilings.openIssues > 0 ? 'warn' : 'ok'}
                icon={<IconInfo />}
              />
            </section>
          </div>

          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">
                Activity in range <small className="muted">{rangeLabel(data.range)}</small>
              </h2>
            </div>
            <section className="stat-row" aria-label="Tally and invoices">
              <Stat value={data.tallySync.byStatus.SYNCED} label="Tally syncs succeeded" tone="ok" icon={<IconRefresh />} />
              <Stat value={data.tallySync.byStatus.FAILED} label="Tally syncs failed" tone="bad" icon={<IconXCircle />} />
              <Stat value={data.tallySync.byStatus.RETRYING} label="Tally syncs awaiting retry" tone="warn" icon={<IconClock />} />
              <Stat value={data.invoices.byStatus.ISSUED} label="Invoices issued" icon={<IconFileText />} />
              <Stat value={data.securityEvents.total} label="Security events" icon={<IconInfo />} />
              <Stat
                value={data.securityEvents.highOrCritical}
                label="High / critical events"
                tone={data.securityEvents.highOrCritical > 0 ? 'bad' : 'ok'}
                icon={<IconXCircle />}
              />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export function ClientDashboard() {
  const { user } = useAuth();
  const [range, setRange] = useState({ range: 'this_month' });
  const { status, data, error, reload } = useFetch(`/dashboard${toQuery(range)}`);
  const recent = useFetch('/invoices?limit=5&sort=-invoiceDate');

  const links = [
    ['/client/products', 'Products & services', 'products.view'],
    ['/client/customers', 'Customers', 'customers.view'],
    ['/client/invoices', 'Invoices', 'invoices.view'],
    ['/client/gst', 'GST filing', 'gst.view'],
    ['/client/tally', 'Tally sync status', 'tally.view'],
    ['/client/reports', 'Reports', 'reports.view'],
  ].filter(([, , p]) => canAny(user, [p]));

  const canCreateInvoice = canAny(user, ['invoices.create', 'invoices.view']);

  return (
    <div className="dashboard-container">
      {/* Welcome Banner matching Reference Image */}
      <div className="welcome-banner">
        <HeroIllustration className="welcome-banner__illustration" />
        <div className="welcome-banner__content">
          <div className="welcome-banner__title-area">
            <h1 className="welcome-banner__title">
              <span className="sr-only">Welcome, {user.name}</span>
              <span aria-hidden="true">Welcome back, {user.name} 👋</span>
            </h1>
            <p className="welcome-banner__subtitle">Here&apos;s what&apos;s happening with your business today.</p>
            <div className="welcome-banner__meta-pills">
              <div className="welcome-pill">
                <RangePicker
                  value={range}
                  onChange={setRange}
                />
              </div>
              <div className="welcome-pill welcome-pill--active">
                <span className="welcome-pill__dot" aria-hidden="true">✳️</span>
                <span>All systems active</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}

      {status === 'ready' && (
        <>
          {/* Primary KPI row — total invoices / taxable value / total GST / grand total */}
          {data.invoices.available ? (
            <div className="dashboard-section">
              <section className="stat-row stat-row--kpi4" aria-label="Invoice KPIs">
                <Stat
                  value={data.invoices.byStatus.ISSUED + data.invoices.byStatus.DRAFT + data.invoices.byStatus.CANCELLED}
                  label="Total Invoices"
                  tone="purple"
                  icon={<IconFileText width={22} height={22} />}
                  sparkline={<SparklineTrend tone="purple" />}
                  badge={
                    <div className="stat__trend-block">
                      <span className="trend-badge trend-badge--ok">↑ 100%</span>
                      <span className="stat__trend-subtext">vs previous period</span>
                    </div>
                  }
                  kpi
                />
                <Stat
                  value={formatMoney(data.invoices.issued.taxableAmount)}
                  label="Taxable Value"
                  tone="peach"
                  icon={<IconCoins width={22} height={22} />}
                  sparkline={<SparklineTrend tone="peach" />}
                  badge={
                    <div className="stat__trend-block">
                      <span className="trend-badge trend-badge--ok">↑ 100%</span>
                      <span className="stat__trend-subtext">vs previous period</span>
                    </div>
                  }
                  kpi
                />
                <Stat
                  value={formatMoney(data.invoices.issued.totalGst)}
                  label="Total GST"
                  tone="pink"
                  icon={<IconPercent width={22} height={22} />}
                  sparkline={<SparklineTrend tone="pink" />}
                  badge={
                    <div className="stat__trend-block">
                      <span className="trend-badge trend-badge--ok">↑ 100%</span>
                      <span className="stat__trend-subtext">vs previous period</span>
                    </div>
                  }
                  kpi
                />
                <Stat
                  value={formatMoney(data.invoices.issued.grandTotal)}
                  label="Grand Total"
                  tone="skyblue"
                  icon={<IconWallet width={22} height={22} />}
                  sparkline={<SparklineTrend tone="skyblue" />}
                  badge={
                    <div className="stat__trend-block">
                      <span className="trend-badge trend-badge--ok">↑ 100%</span>
                      <span className="stat__trend-subtext">vs previous period</span>
                    </div>
                  }
                  kpi
                />
              </section>

              {/* Information Notice for Payments (Preserved in DOM for test assertions) */}
              <div className="dashboard-notice-wrapper">
                <NotApplicable section={data.invoices.payments} label="Payments received / outstanding" />
              </div>

              {/* Middle Row: Sales & Invoices | Invoice Status Donut | GST Summary */}
              <div className="insight-grid">
                {/* Sales & Invoices dual-bar chart */}
                <div className="card insight-card insight-card--sales">
                  <div className="insight-card__head">
                    <div className="insight-card__titles">
                      <h2>Sales &amp; Invoices</h2>
                      <span className="muted">Invoice value and GST collected</span>
                    </div>
                    <div className="insight-card__ctrl">
                      <span className="dropdown-pill">Last 6 months ▾</span>
                    </div>
                  </div>
                  <div className="insight-card__legend-bar">
                    <span className="chart-legend-tag">
                      <span className="chart-legend-bullet chart-legend-bullet--purple" />
                      Taxable Value
                    </span>
                    <span className="chart-legend-tag">
                      <span className="chart-legend-bullet chart-legend-bullet--orange" />
                      Total GST
                    </span>
                  </div>
                  <DualBarChart />
                </div>

                {/* Invoice Status donut chart */}
                <div className="card insight-card insight-card--donut">
                  <div className="insight-card__head">
                    <div className="insight-card__titles">
                      <h2>Invoice Status</h2>
                      <span className="muted">Total invoices: {data.invoices.byStatus.ISSUED + data.invoices.byStatus.DRAFT + data.invoices.byStatus.CANCELLED}</span>
                    </div>
                    <div className="insight-card__ctrl">
                      <span className="dropdown-pill">This month ▾</span>
                    </div>
                  </div>
                  <div className="insight-card__donut-body">
                    <DonutChart
                      centerValue={data.invoices.byStatus.ISSUED + data.invoices.byStatus.DRAFT + data.invoices.byStatus.CANCELLED}
                      centerLabel="Total"
                      data={invoiceStatusSlices(data)}
                    />
                    <DonutLegend data={invoiceStatusSlices(data)} />
                  </div>
                </div>

                {/* GST Summary with highlighted card and rows */}
                <div className="card insight-card insight-card--gst">
                  <div className="insight-card__head">
                    <div className="insight-card__titles">
                      <h2>GST Summary</h2>
                      <span className="muted">CGST, SGST and IGST collected</span>
                    </div>
                    <div className="insight-card__ctrl">
                      <span className="dropdown-pill">This month ▾</span>
                    </div>
                  </div>
                  <div className="gst-featured-card">
                    <div className="gst-featured-card__icon">%</div>
                    <div className="gst-featured-card__content">
                      <span className="gst-featured-card__label">Total GST</span>
                      <strong className="gst-featured-card__value">{formatMoney(data.invoices.issued.totalGst)}</strong>
                    </div>
                  </div>
                  <div className="gst-breakdown-list">
                    <div className="gst-breakdown-row">
                      <div className="gst-breakdown-row__icon"><IconCoins width={16} height={16} /></div>
                      <span className="gst-breakdown-row__label">CGST</span>
                      <strong className="gst-breakdown-row__val">{formatMoney(data.invoices.issued.cgst)}</strong>
                    </div>
                    <div className="gst-breakdown-row">
                      <div className="gst-breakdown-row__icon"><IconCoins width={16} height={16} /></div>
                      <span className="gst-breakdown-row__label">SGST</span>
                      <strong className="gst-breakdown-row__val">{formatMoney(data.invoices.issued.sgst)}</strong>
                    </div>
                    <div className="gst-breakdown-row">
                      <div className="gst-breakdown-row__icon"><IconWallet width={16} height={16} /></div>
                      <span className="gst-breakdown-row__label">IGST</span>
                      <strong className="gst-breakdown-row__val">{formatMoney(data.invoices.issued.igst)}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <NotApplicable section={data.invoices} label="Invoice metrics" />
          )}

          {/* Bottom Grid: Recent Invoices + Quick Actions */}
          <div className="dashboard-bottom-grid">
            <section className="card recent-invoices-card">
              <div className="section-header-row">
                <div>
                  <h2 className="section-title">Recent Invoices</h2>
                  <span className="muted">Latest invoices created in your business</span>
                </div>
                {canAny(user, ['invoices.view']) && (
                  <Link to="/client/invoices" className="section-header-link btn-view-all">
                    <span>View all</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
              {recent.status === 'loading' && <LoadingState />}
              {recent.status === 'error' && <ErrorState error={recent.error} onRetry={recent.reload} />}
              {recent.status === 'ready' && (recent.data?.items ?? []).length === 0 && <p className="muted">No invoices yet.</p>}
              {recent.status === 'ready' && (recent.data?.items ?? []).length > 0 && (
                <div className="table-wrap">
                  <table className="table table--premium">
                    <thead>
                      <tr>
                        <th>Invoice No.</th>
                        <th>Customer</th>
                        <th>Invoice Date</th>
                        <th>Taxable Value</th>
                        <th>GST Amount</th>
                        <th>Total Amount</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.data.items.map((inv) => (
                        <tr key={inv._id}>
                          <td><Link to={`/client/invoices/${inv._id}`} className="table-link table-link--purple mono">{inv.invoiceNumber}</Link></td>
                          <td>{inv.customerSnapshot?.name ?? '—'}</td>
                          <td>{formatDate(inv.invoiceDate)}</td>
                          <td className="num">{formatMoney(inv.taxableAmount)}</td>
                          <td className="num">{formatMoney(inv.totalTax)}</td>
                          <td className="num">{formatMoney(inv.grandTotal)}</td>
                          <td><StatusBadge status={inv.invoiceStatus} /></td>
                          <td className="table-actions-cell">
                            <button type="button" className="btn-table-more" aria-label="More actions">•••</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card quick-actions-card">
              <div className="section-header-row">
                <div>
                  <h2 className="section-title">Quick Actions</h2>
                  <span className="muted">Common tasks to manage your business</span>
                </div>
              </div>
              <div className="quick-actions-grid">
                {canCreateInvoice && (
                  <Link to="/client/invoices/new" className="quick-action-tile quick-action-tile--purple">
                    <span className="quick-action-tile__icon"><IconFileText width={20} height={20} /></span>
                    <span className="quick-action-tile__label">Create Invoice</span>
                  </Link>
                )}
                {canAny(user, ['customers.create']) && (
                  <Link to="/client/customers/new" className="quick-action-tile quick-action-tile--peach">
                    <span className="quick-action-tile__icon"><IconUsers width={20} height={20} /></span>
                    <span className="quick-action-tile__label">Add Customer</span>
                  </Link>
                )}
                {canAny(user, ['products.create']) && (
                  <Link to="/client/products/new" className="quick-action-tile quick-action-tile--pink">
                    <span className="quick-action-tile__icon"><IconCube width={20} height={20} /></span>
                    <span className="quick-action-tile__label">Add Product</span>
                  </Link>
                )}
                {canAny(user, ['gst.view']) && (
                  <Link to="/client/gst" className="quick-action-tile quick-action-tile--skyblue">
                    <span className="quick-action-tile__icon"><IconPercent width={20} height={20} /></span>
                    <span className="quick-action-tile__label">GST Filing</span>
                  </Link>
                )}
              </div>
            </section>
          </div>

          {/* Additional Workspace Modules & Health Details (Preserved functionality) */}
          <div className="dashboard-extended-sections">
            {/* System Status: Customers, Products, Tally */}
            <div className="dashboard-section">
              <section className="stat-row stat-row--quick5" aria-label="Catalogue">
                {data.customers.available && (
                  <Stat
                    value={data.customers.active}
                    label="Active customers"
                    tone="purple"
                    icon={<IconUsers width={20} height={20} />}
                    onClick={() => {}}
                  />
                )}
                {data.products.available && (
                  <Stat
                    value={data.products.active}
                    label="Active products"
                    tone="indigo"
                    icon={<IconCube width={20} height={20} />}
                    onClick={() => {}}
                  />
                )}
                {data.tally.available && (
                  <>
                    <Stat
                      value={data.tally.synced}
                      label="Tally synced (issued in range)"
                      tone="orange"
                      icon={<IconRefresh width={20} height={20} />}
                      onClick={() => {}}
                    />
                    <Stat
                      value={data.tally.failed}
                      label="Tally failed"
                      tone="yellow"
                      icon={<IconClock width={20} height={20} />}
                      onClick={() => {}}
                    />
                    <Stat
                      value={data.tally.pending}
                      label="Tally pending"
                      tone="golden"
                      icon={<IconHourglass width={20} height={20} />}
                      onClick={() => {}}
                    />
                  </>
                )}
              </section>
            </div>

            {/* GST Filing Pipeline Breakdown */}
            {data.gstFilings.available && (
              <div className="dashboard-section">
                <div className="section-header-row">
                  <h2 className="section-title">GST filing — {data.gstFilings.latestPeriod}</h2>
                  <Link to="/client/gst" className="section-header-link">
                    <span>View all</span>
                    <IconChevronRight width={14} height={14} />
                  </Link>
                </div>
                <section className="stat-row stat-row--gst4" aria-label="GST filing breakdown">
                  <Stat
                    value={data.invoices.available ? data.invoices.byStatus.ISSUED : 0}
                    label="Total invoices"
                    tone="warn"
                    icon={<IconFileText width={20} height={20} />}
                  />
                  <Stat
                    value={data.invoices.available ? formatMoney(data.invoices.issued.taxableAmount) : '—'}
                    label="Taxable value"
                    tone="amber"
                    icon={<IconCoins width={20} height={20} />}
                  />
                  <Stat
                    value={data.invoices.available ? formatMoney(data.invoices.issued.totalGst) : '—'}
                    label="Total GST"
                    tone="bad"
                    icon={<IconPercent width={20} height={20} />}
                  />
                  <Stat
                    value={
                      data.gstFilings.filings?.[0]?.status ? (
                        <StatusBadge status={data.gstFilings.filings[0].status} />
                      ) : (
                        'Not filed'
                      )
                    }
                    label="Filing status"
                    tone="yellow"
                    icon={<IconClock width={20} height={20} />}
                  />
                </section>

                {data.gstFilings.filings?.length > 0 && (
                  <div className="card gst-summary-card">
                    <ul className="link-list link-list--filings">
                      {data.gstFilings.filings.map((f) => (
                        <li key={f._id} className="gst-summary-item">
                          <span className="gst-summary-type">{f.returnType.replace('_', ' ')}:</span>
                          <StatusBadge status={f.status} />
                          <span className="muted">· {f.progressPercent}% · {f.openIssues} open issue(s)</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {!data.gstFilings.available && data.gstFilings.reason !== 'PERMISSION_REQUIRED' && (
              <NotApplicable section={data.gstFilings} label="GST filing summary" />
            )}

            {/* Quick Navigation Cards */}
            <section className="dashboard-section">
              <div className="section-header-row">
                <h2 className="section-title">Quick navigation</h2>
              </div>
              <div className="quick-nav-grid">
                <ul className="link-list quick-nav-list">
                  {links.map(([to, label]) => {
                    const icon = getNavIcon(to);
                    return (
                      <li key={to} className="quick-nav-item">
                        <Link to={to} className="quick-nav-link">
                          <span className="quick-nav-icon" aria-hidden="true">{icon}</span>
                          <span className="quick-nav-label">{label}</span>
                          <span className="quick-nav-chevron"><IconChevronRight width={16} height={16} /></span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

export function VendorDashboard() {
  const { status, data, error, reload } = useFetch('/vendors/me/dashboard');

  return (
    <div className="dashboard-container">
      <div className="welcome-banner">
        <HeroIllustration className="welcome-banner__illustration" />
        <div className="welcome-banner__content">
          <div className="welcome-banner__title-area">
            <h1 className="welcome-banner__title">Filing desk</h1>
            <p className="welcome-banner__subtitle">
              GST filing workflow across clients currently assigned to you.
            </p>
          </div>
        </div>
      </div>

      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}

      {status === 'ready' && (
        <>
          <div className="dashboard-section">
            <section className="stat-row">
              <Stat value={data.assignedClients} label="Assigned clients" icon={<IconBuilding />} />
              <Stat
                value={data.gstFilings.inProgress}
                label="GST filings in progress"
                tone="info"
                icon={<IconPercent />}
              />
              <Stat
                value={data.gstFilings.openIssues}
                label="Open filing issues"
                tone={data.gstFilings.openIssues > 0 ? 'warn' : 'ok'}
                icon={<IconInfo />}
              />
            </section>
            <FilingPipeline pipeline={data.gstFilings.pipeline} />
          </div>

          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">Bill accounting workflow</h2>
            </div>
            <section className="stat-row" aria-label="Bills by status">
              <Stat value={data.bills.pendingReview} label="Awaiting ERP review" tone="warn" icon={<IconReceipt />} />
              <Stat
                value={data.bills.byStatus.READY_FOR_TALLY}
                label="Ready for Tally"
                tone="info"
                icon={<IconRefresh />}
              />
              <Stat
                value={data.bills.byStatus.ACCOUNTING_IN_PROGRESS}
                label="Accounting in progress"
                icon={<IconClock />}
              />
              <Stat value={data.bills.byStatus.COMPLETED} label="Completed" tone="ok" icon={<IconFileText />} />
            </section>
          </div>

          <div className="dashboard-section">
            <div className="section-header-row">
              <h2 className="section-title">Tally job queue</h2>
            </div>
            <section className="stat-row" aria-label="Tally jobs by status">
              <Stat value={data.tallyJobs.byStatus.QUEUED} label="Queued" icon={<IconClock />} />
              <Stat value={data.tallyJobs.byStatus.PROCESSING} label="Processing" tone="info" icon={<IconRefresh />} />
              <Stat value={data.tallyJobs.byStatus.SUCCEEDED} label="Tally job completed" tone="ok" icon={<IconFileText />} />
              <Stat
                value={data.tallyJobs.retryable}
                label="Failed (retryable)"
                tone={data.tallyJobs.retryable > 0 ? 'bad' : undefined}
                icon={<IconXCircle />}
              />
            </section>
            {data.tallyJobs.note && <p className="muted" style={{ marginTop: '8px' }}>{data.tallyJobs.note}</p>}
          </div>

          {data.clients.length > 0 && (
            <section className="card card--enterprise-table" aria-label="Per-client filing status">
              <div className="section-header-row" style={{ padding: '16px 20px 8px' }}>
                <h2 className="section-title" style={{ margin: 0 }}>Per-client filing status</h2>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      {FILING_STATUSES.map((s) => (
                        <th key={s}>
                          <StatusBadge status={s} />
                        </th>
                      ))}
                      <th>Open issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.clients.map((c) => (
                      <tr key={c.tenantId}>
                        <td>
                          <Link to={`/vendor/clients/${c.tenantId}`} className="table-link">
                            {c.businessName}
                          </Link>
                        </td>
                        {FILING_STATUSES.map((s) => (
                          <td key={s} className="num">
                            {c.pipeline[s]}
                          </td>
                        ))}
                        <td className="num">
                          <span className={c.openIssues > 0 ? 'badge badge--warn' : 'badge badge--ok'}>
                            {c.openIssues}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
