import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import {
  PageHeader,
  Card,
  CardHeader,
  CardBody,
  StatusBadge,
  ConfirmModal,
  DefinitionList,
  DefinitionItem,
  Button,
  Modal,
  FormField,
  TextInput,
  Textarea,
  ErrorState,
  LoadingState,
} from '../../design-system/index.js';
import { formatDate, formatDateTime } from '../../utils/format.js';

const STATUS_ACTIONS = [
  { to: 'ACTIVE', label: 'Activate', needsReason: false, danger: false },
  { to: 'SUSPENDED', label: 'Suspend', needsReason: true, danger: true },
  { to: 'INACTIVE', label: 'Deactivate', needsReason: true, danger: true },
];

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
          <div className="toolbar" style={{ alignItems: 'center' }}>
            <StatusBadge status={tenant.status} />
            <Button onClick={startEdit}>Edit</Button>
            {STATUS_ACTIONS.filter((a) => a.to !== tenant.status).map((a) => (
              <Button
                key={a.to}
                variant={a.danger ? 'danger' : 'secondary'}
                onClick={() => { setPendingStatus(a); setReason(''); }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}
      />
      {notice && <p className="state" role="status">{notice}</p>}

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Business profile" />
        <CardBody>
          <DefinitionList>
            <DefinitionItem label="Legal name" value={tenant.legalName} />
            <DefinitionItem label="GSTIN" value={tenant.gstin} mono />
            <DefinitionItem label="PAN" value={tenant.pan} mono />
            <DefinitionItem label="Email" value={tenant.email} />
            <DefinitionItem label="Phone" value={tenant.phone} />
            <DefinitionItem
              label="Address"
              value={[tenant.address?.line1, tenant.address?.city, tenant.address?.state, tenant.address?.pincode].filter(Boolean).join(', ') || '—'}
            />
          </DefinitionList>
        </CardBody>
      </Card>

      <Card style={{ marginBottom: '1.25rem' }}>
        <CardHeader title="Users" />
        <CardBody>
          <div className="stat-row">
            <div className="stat"><span className="stat__value">{summary.users.total}</span><span className="muted">Total</span></div>
            <div className="stat"><span className="stat__value">{summary.users.active}</span><span className="muted">Active</span></div>
            <div className="stat"><span className="stat__value">{summary.users.pending}</span><span className="muted">Pending</span></div>
            <div className="stat"><span className="stat__value">{summary.users.suspended}</span><span className="muted">Suspended</span></div>
            {summary.activeVendorAssignments !== null && summary.activeVendorAssignments !== undefined && (
              <div className="stat"><span className="stat__value">{summary.activeVendorAssignments}</span><span className="muted">Active vendor assignments</span></div>
            )}
          </div>
        </CardBody>
      </Card>

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit client"
        footer={(
          <>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={saveEdit}>Save</Button>
          </>
        )}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <FormField label="Business name" required>
            <TextInput value={edit?.businessName ?? ''} onChange={(e) => setEdit((f) => ({ ...f, businessName: e.target.value }))} required />
          </FormField>
          <FormField label="Legal name">
            <TextInput value={edit?.legalName ?? ''} onChange={(e) => setEdit((f) => ({ ...f, legalName: e.target.value }))} />
          </FormField>
          <FormField label="GSTIN">
            <TextInput value={edit?.gstin ?? ''} onChange={(e) => setEdit((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))} />
          </FormField>
          <FormField label="PAN">
            <TextInput value={edit?.pan ?? ''} onChange={(e) => setEdit((f) => ({ ...f, pan: e.target.value.toUpperCase() }))} />
          </FormField>
          <FormField label="Email">
            <TextInput type="email" value={edit?.email ?? ''} onChange={(e) => setEdit((f) => ({ ...f, email: e.target.value }))} />
          </FormField>
          <FormField label="Phone">
            <TextInput value={edit?.phone ?? ''} onChange={(e) => setEdit((f) => ({ ...f, phone: e.target.value }))} />
          </FormField>
        </div>
      </Modal>

      {pendingStatus && pendingStatus.needsReason && (
        <Modal
          open={Boolean(pendingStatus)}
          onClose={() => setPendingStatus(null)}
          title={`${pendingStatus.label} ${tenant.businessName}?`}
          footer={(
            <>
              <Button onClick={() => setPendingStatus(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 5}
                onClick={applyStatus}
              >
                {pendingStatus.label}
              </Button>
            </>
          )}
        >
          <FormField label="Reason (required)" required hint="Minimum 5 characters">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={5}
              maxLength={500}
              required
              rows={4}
              placeholder="State the reason for this administrative status change…"
            />
          </FormField>
        </Modal>
      )}

      {pendingStatus && !pendingStatus.needsReason && (
        <ConfirmModal
          open={Boolean(pendingStatus)}
          title={`${pendingStatus.label} ${tenant.businessName}?`}
          message="This takes effect immediately."
          confirmLabel={pendingStatus.label}
          onConfirm={applyStatus}
          onCancel={() => setPendingStatus(null)}
        />
      )}

      <p className="muted" style={{ fontSize: '13px' }}>Full audit history of this client is available under Platform → Audit logs. Last touched {formatDateTime(tenant.updatedAt)}.</p>
    </>
  );
}
