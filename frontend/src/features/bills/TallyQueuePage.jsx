import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  PageHeader,
  Card,
  StatusBadge,
  ConfirmModal,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDateTime } from '../../utils/format.js';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, TALLY_STATUSES } from './billsApi.js';

export default function TallyQueuePage({ detailBasePath }) {
  const { user } = useAuth();
  const canRetry = can(user, 'bills.tally_manage');
  const [tallyStatus, setTallyStatus] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams();
  if (tallyStatus) params.set('tallyStatus', tallyStatus);
  params.set('page', String(page));
  const query = `?${params.toString()}`;
  const { status, data, error, reload } = useFetch(`/tally/queue${query}`, [query]);
  const [confirmRetryId, setConfirmRetryId] = useState(null);
  const [retryError, setRetryError] = useState(null);

  const onStatusChange = (e) => { setTallyStatus(e.target.value); setPage(1); };

  const runRetry = async () => {
    const id = confirmRetryId;
    setConfirmRetryId(null);
    setRetryError(null);
    try {
      await api.post(`/bills/${id}/tally/retry`);
      reload();
    } catch (err) {
      setRetryError(err.message ?? 'Could not retry this job');
    }
  };

  const pagination = status === 'ready' ? data.pagination : null;

  return (
    <>
      <PageHeader title="Tally queue" subtitle="Bills ready for (or being processed through) the Tally Connector." />
      <Card>
        <div className="toolbar" style={{ marginBottom: '1.25rem' }}>
          <label className="field field--inline">
            <span className="sr-only">Tally status</span>
            <select value={tallyStatus} onChange={onStatusChange}>
              <option value="">All Tally statuses</option>
              {TALLY_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {retryError && <p className="state state--error" role="alert">{retryError}</p>}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.items.length === 0 && <EmptyState title="Queue is empty" hint="No bills are currently ready for Tally processing." />}
        {status === 'ready' && data.items.length > 0 && (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bill number</th><th>Amount</th><th>ERP status</th><th>Tally status</th><th>Ready since</th><th>Last attempt</th><th>Failure reason</th>{canRetry && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id}>
                    <td><Link to={`${detailBasePath}/${b.id}`}>{b.billNumber ?? b.id}</Link></td>
                    <td>{b.amount ?? '—'}</td>
                    <td><StatusBadge status={b.status} /></td>
                    <td><StatusBadge status={b.tallyStatus} /></td>
                    <td>{b.readyAt ? formatDateTime(b.readyAt) : '—'}</td>
                    <td>{b.lastSyncAttemptAt ? formatDateTime(b.lastSyncAttemptAt) : '—'}</td>
                    <td>{b.failureReason ?? '—'}</td>
                    {canRetry && (
                      <td>
                        {b.retryAvailable && (
                          <button type="button" className="btn btn--small" onClick={() => setConfirmRetryId(b.id)}>Retry</button>
                        )}
                        {!b.retryAvailable && '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {pagination && (
              <div className="toolbar" style={{ justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <span className="muted">Page {pagination.page} of {pagination.totalPages ?? Math.max(1, Math.ceil((pagination.total ?? 0) / (pagination.limit ?? 20)))} ({pagination.total} total)</span>
                <button type="button" className="btn btn--small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={pagination.totalPages ? page >= pagination.totalPages : data.items.length < (pagination.limit ?? 20)}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </Card>

      <ConfirmModal
        open={Boolean(confirmRetryId)}
        title="Retry Tally sync?"
        message="This bill will be re-queued for Tally processing."
        confirmLabel="Retry"
        onConfirm={runRetry}
        onCancel={() => setConfirmRetryId(null)}
      />
    </>
  );
}
