import React from 'react';
import {
  PageHeader,
  Card,
  StatusBadge,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDate } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFetch } from './vendorsApi.js';

export default function ClientGstVendorPage() {
  const { user } = useAuth();
  const { status, data, error, reload } = useFetch(`/clients/${user.tenantId}/vendors`);
  return (
    <>
      <PageHeader title="GST vendor" subtitle="Filing partner(s) assigned to your account by the platform administrator." />
      {status === 'loading' && <LoadingState />}
      {status === 'error' && <ErrorState error={error} onRetry={reload} />}
      {status === 'ready' && data.length === 0 && (
        <EmptyState title="No vendor assigned" hint="Contact your platform administrator to assign a GST filing partner." />
      )}
      {status === 'ready' && data.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Vendor</th><th>Email</th><th>Status</th><th>Assigned on</th></tr></thead>
              <tbody>
                {data.map((a) => (
                  <tr key={a.assignmentId}>
                    <td><strong>{a.vendor?.name ?? '—'}</strong></td>
                    <td>{a.vendor?.contactEmail ?? '—'}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td>{formatDate(a.assignedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
