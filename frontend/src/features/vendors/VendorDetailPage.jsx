import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  ConfirmModal,
  Modal,
  FormField,
  Textarea,
  Button,
  ErrorState,
  LoadingState,
  EmptyState,
} from '../../design-system/index.js';
import { formatDate } from '../../utils/format.js';
import { useFetch } from './vendorsApi.js';

export default function VendorDetailPage() {
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
      <PageHeader
        title={vendor.name}
        subtitle={`${vendor.vendorCode} · ${vendor.contactEmail ?? ''}`}
        actions={<StatusBadge status={vendor.status} />}
      />
      {notice && <p className="state" role="status">{notice}</p>}

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Assign a new client" />
        <CardBody>
          <form className="toolbar" onSubmit={assign} style={{ gap: '0.75rem' }}>
            <label className="field field--inline" style={{ flex: 1, maxWidth: 360 }}>
              <span className="sr-only">Tenant id</span>
              <input className="input" placeholder="Client (tenant) id" required value={assignTenantId} onChange={(e) => setAssignTenantId(e.target.value)} />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>Assign</Button>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Assignment history" />
        <CardBody>
          {assignments.length === 0 && <EmptyState title="No assignments yet" />}
          {assignments.length > 0 && (
            <div className="table-wrap">
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
                        {a.status === 'ACTIVE' && <Button size="sm" variant="danger" onClick={() => setLifecycle({ assignmentId: a._id, action: 'deactivate' })}>Deactivate</Button>}
                        {a.status === 'INACTIVE' && <Button size="sm" onClick={() => setLifecycle({ assignmentId: a._id, action: 'reactivate' })}>Reactivate</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {lifecycle?.action === 'deactivate' && (
        <Modal
          open={Boolean(lifecycle)}
          onClose={() => setLifecycle(null)}
          title="Deactivate assignment"
          footer={(
            <>
              <Button onClick={() => setLifecycle(null)}>Cancel</Button>
              <Button variant="danger" disabled={busy || !reason.trim()} onClick={runLifecycle}>
                Deactivate
              </Button>
            </>
          )}
        >
          <FormField label="Reason (required)" required>
            <Textarea
              required
              minLength={1}
              maxLength={500}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="State the reason for deactivating this client assignment…"
            />
          </FormField>
        </Modal>
      )}

      {lifecycle?.action === 'reactivate' && (
        <ConfirmModal
          open
          title="Reactivate this assignment?"
          message="The vendor will immediately regain access to this client's data."
          confirmLabel="Reactivate"
          onConfirm={runLifecycle}
          onCancel={() => setLifecycle(null)}
        />
      )}
    </>
  );
}
