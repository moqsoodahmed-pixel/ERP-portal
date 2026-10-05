import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
import { formatDate } from '../../utils/format.js';
import { useFetch, RETURN_TYPES, FILING_STATUSES } from './filingsApi.js';

/**
 * Role-agnostic GST filing WORKFLOW TRACKER list (ERP-internal — not a government portal view).
 * - Master Admin ("/master/filings"): cross-tenant, all filters available.
 * - Vendor ("/vendor/filings"): server already restricts to the vendor's own ACTIVE assignments.
 * - Client ("/client/gst-filings"): server already restricts to the caller's own tenant; read-only.
 */
export default function FilingListPage({ basePath, title, subtitle, showClientColumn = false }) {
  const [filters, setFilters] = useState({ period: '', returnType: '', status: '' });
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const { status, data, error, reload } = useFetch(`/gst-filings${query ? `?${query}` : ''}`, [query]);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <section className="card">
        <div className="toolbar">
          <label className="field field--inline">
            <span className="sr-only">Period</span>
            <input placeholder="Period (YYYY-MM)" value={filters.period} onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value }))} />
          </label>
          <label className="field field--inline">
            <span className="sr-only">Return type</span>
            <select value={filters.returnType} onChange={(e) => setFilters((f) => ({ ...f, returnType: e.target.value }))}>
              <option value="">All return types</option>
              {RETURN_TYPES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </label>
          <label className="field field--inline">
            <span className="sr-only">Status</span>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {FILING_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.items.length === 0 && <EmptyState title="No filings found" hint="Nothing matches the current filters yet." />}
        {status === 'ready' && data.items.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                {showClientColumn && <th>Client</th>}
                <th>Period</th><th>Return</th><th>Status</th><th>Progress</th><th>Due date</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f._id}>
                  {showClientColumn && <td className="mono">{f.tenantId}</td>}
                  <td>
                    <Link to={showClientColumn ? `${basePath}/${f._id}?tenantId=${f.tenantId}` : `${basePath}/${f._id}`}>
                      {f.periodLabel ?? f.periodKey}
                    </Link>
                  </td>
                  <td>{f.returnType.replace('_', ' ')}</td>
                  <td><StatusBadge status={f.status} /></td>
                  <td>{f.progressPercent}%</td>
                  <td>{f.dueDate ? formatDate(f.dueDate) : '—'}</td>
                  <td>{formatDate(f.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
