import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, BILL_STATUSES } from './billsApi.js';

/**
 * Phase 15 — role-agnostic bill list.
 * - Client ("/client/bills"): own tenant's bills only (server-enforced); can create a new draft bill.
 * - Master Admin ("/master/bills"): platform-wide (per existing permissions).
 * - Vendor ("/vendor/bills"): assigned clients' bills only (server-enforced via the Phase 7 assignment chain).
 */
export default function BillListPage({ basePath, title, subtitle, showCreate = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ status: '' });
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v))).toString();
  const { status, data, error, reload } = useFetch(`/bills${query ? `?${query}` : ''}`, [query]);

  const createDraft = async () => {
    setBusy(true);
    try {
      const res = await api.post('/bills', {});
      navigate(`${basePath}/${res.data._id}`);
    } catch (err) {
      window.alert(err.message ?? 'Could not create a draft bill');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={showCreate && can(user, 'bills.create') && (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={createDraft}>Upload a new bill</button>
        )}
      />
      <section className="card">
        <div className="toolbar">
          <label className="field field--inline">
            <span className="sr-only">Status</span>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {BILL_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </label>
        </div>
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.items.length === 0 && <EmptyState title="No bills found" hint="Nothing matches the current filters yet." />}
        {status === 'ready' && data.items.length > 0 && (
          <table className="data-table">
            <thead>
              <tr><th>Bill number</th><th>Bill date</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Tally status</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {data.items.map((b) => (
                <tr key={b._id}>
                  <td><Link to={`${basePath}/${b._id}`}>{b.billNumber ?? '(no number yet)'}</Link></td>
                  <td>{b.billDate ? formatDate(b.billDate) : '—'}</td>
                  <td>{b.vendorName ?? '—'}</td>
                  <td>{b.amount ?? '—'}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td><StatusBadge status={b.tallyStatus} /></td>
                  <td>{formatDateTime(b.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
