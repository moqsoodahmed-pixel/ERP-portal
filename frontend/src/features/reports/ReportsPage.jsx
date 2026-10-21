import { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader.jsx';
import DataTable from '../../components/DataTable.jsx';
import { EmptyState, ErrorState, LoadingState } from '../../components/states.jsx';
import { api, toQuery } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { RangePicker } from '../dashboard/dashboards.jsx';
import { REPORT_COLUMNS, STATUS_OPTIONS, SummaryView } from './reportColumns.jsx';
import {
  Card,
  CardBody,
  Button,
} from '../../design-system/index.js';

/**
 * Role-agnostic reports page.
 *  - mode "tenant": the caller's own tenant (server resolves it from the session) — /reports/*
 *  - mode "master": Master Admin cross-tenant filing reports — /master/reports/*
 *  - mode "vendor": one ASSIGNED client at a time — /vendors/me/clients/:tenantId/reports/* (server re-checks the assignment)
 * The browser never sends a tenantId for tenant/master reports and never totals rows itself.
 */
const BASES = { tenant: '/reports', master: '/master/reports' };

/** Loading state is derived from "has the current path resolved yet" (no synchronous setState inside the effect). */
function useJson(path) {
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    if (!path) return undefined;
    let live = true;
    api.get(path).then((r) => live && setState({ key: path, data: r.data, error: null }))
      .catch((error) => live && setState({ key: path, data: null, error }));
    return () => { live = false; };
  }, [path]);
  if (!path) return { status: 'idle', data: null, error: null };
  if (state.key !== path) return { status: 'loading', data: null, error: null };
  return { status: state.error ? 'error' : 'ready', data: state.data, error: state.error };
}

export default function ReportsPage({ mode = 'tenant' }) {
  const { user } = useAuth();
  const catalog = useJson(mode === 'master' ? '/master/reports' : '/reports');
  const clients = useJson(mode === 'vendor' ? '/vendors/me/clients' : null);
  const [type, setType] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [range, setRange] = useState({ range: '' });
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [exportState, setExportState] = useState({ busy: false, error: null });

  const selectedType = type || catalog.data?.[0]?.key || '';
  const selectedTenant = mode === 'vendor' ? (tenantId || clients.data?.[0]?.id || '') : null;
  const base = mode === 'vendor' ? (selectedTenant ? `/vendors/me/clients/${selectedTenant}/reports` : null) : BASES[mode];
  const query = toQuery({ ...range, status: statusFilter, page, limit: 20 });
  const report = useJson(base && selectedType ? `${base}/${selectedType}${query}` : null);
  const canExport = mode !== 'vendor' && can(user, 'reports.export');

  const reset = (fn) => (v) => { fn(v); setPage(1); };
  const doExport = async () => {
    setExportState({ busy: true, error: null });
    try {
      const { blob, fileName } = await api.getBlob(`${base}/${selectedType}/export${toQuery({ ...range, status: statusFilter })}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
      setExportState({ busy: false, error: null });
    } catch (error) {
      setExportState({ busy: false, error });
    }
  };

  return (
    <div className="page-container" style={{ display: 'grid', gap: '1.5rem' }}>
      <PageHeader
        title="Reports"
        subtitle={
          mode === 'master'
            ? 'Cross-tenant GST filing workflow reports.'
            : mode === 'vendor'
              ? 'Reports for one assigned client at a time.'
              : 'Tenant-scoped business reports. Totals are computed on the server across all matching rows.'
        }
      />
      {catalog.status === 'loading' && <LoadingState />}
      {catalog.status === 'error' && <ErrorState error={catalog.error} />}
      {catalog.status === 'ready' && catalog.data.length === 0 && (
        <EmptyState title="No reports available" hint="Your account does not have access to any report." />
      )}
      {catalog.status === 'ready' && catalog.data.length > 0 && (
        <Card>
          <CardBody>
            <div className="toolbar" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              {mode === 'vendor' && (
                <label className="field field--inline" style={{ margin: 0 }}>
                  <span className="sr-only">Client</span>
                  <select value={selectedTenant ?? ''} onChange={(e) => reset(setTenantId)(e.target.value)} className="input" style={{ minWidth: '180px' }}>
                    {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.businessName}</option>)}
                  </select>
                </label>
              )}
              <label className="field field--inline" style={{ margin: 0 }}>
                <span className="sr-only">Report</span>
                <select value={selectedType} onChange={(e) => { reset(setType)(e.target.value); setStatusFilter(''); }} className="input" style={{ minWidth: '200px' }}>
                  {catalog.data.map((r) => <option key={r.key} value={r.key}>{r.title}</option>)}
                </select>
              </label>
              {STATUS_OPTIONS[selectedType] && (
                <label className="field field--inline" style={{ margin: 0 }}>
                  <span className="sr-only">Status</span>
                  <select value={statusFilter} onChange={(e) => reset(setStatusFilter)(e.target.value)} className="input" style={{ minWidth: '150px' }}>
                    <option value="">All statuses</option>
                    {STATUS_OPTIONS[selectedType].map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ').toLowerCase()}</option>)}
                  </select>
                </label>
              )}
              <RangePicker value={range} onChange={reset(setRange)} allowDefault />
              {canExport && (
                <Button type="button" variant="primary" className="btn btn--primary" onClick={doExport} disabled={exportState.busy}>
                  {exportState.busy ? 'Exporting…' : 'Export CSV'}
                </Button>
              )}
            </div>
            {exportState.error && <ErrorState error={exportState.error} />}
            {mode === 'vendor' && clients.status === 'ready' && clients.data.length === 0 && <EmptyState title="No assigned clients" />}
            {report.status === 'loading' && <LoadingState />}
            {report.status === 'error' && <ErrorState error={report.error} />}
            {report.status === 'ready' && (
              <>
                <SummaryView summary={report.data.summary} />
                {report.data.items.length === 0 ? (
                  <EmptyState title="No rows match these filters" />
                ) : (
                  <DataTable
                    caption={report.data.title}
                    columns={REPORT_COLUMNS[selectedType] ?? []}
                    rows={report.data.items}
                    pagination={report.data.pagination}
                    onPage={setPage}
                  />
                )}
              </>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
