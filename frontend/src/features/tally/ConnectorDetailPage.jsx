import { useState } from 'react';
import { useParams } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import { formatDateTime } from '../../utils/format.js';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import { useFetch, deriveConnectorDisplayStatus } from './connectorsApi.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
} from '../../design-system/index.js';

/** Phase 16.1 — single connector detail view, including last-error and last-sync diagnostics (spec Step 20/21). */
export default function ConnectorDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canManage = can(user, 'tally.connector.manage');
  const { status, data: c, error, reload } = useFetch(`/tally/connectors/${id}`, [id]);
  const [revealed, setRevealed] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionError, setActionError] = useState(null);

  const runConfirmedAction = async () => {
    const { type } = confirmAction;
    setConfirmAction(null);
    setActionError(null);
    try {
      if (type === 'revoke') {
        await api.post(`/tally/connectors/${id}/revoke`);
        reload();
      } else {
        const { data: rotated } = await api.post(`/tally/connectors/${id}/rotate`);
        setRevealed(rotated.connectorSecret);
        reload();
      }
    } catch (err) {
      setActionError(err.message ?? 'Action failed');
    }
  };

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState error={error} onRetry={reload} />;

  const display = deriveConnectorDisplayStatus(c);

  return (
    <div className="page-container" style={{ display: 'grid', gap: '1.5rem' }}>
      <PageHeader
        title={c.name}
        subtitle={`Connector ${c.id}`}
        actions={<span className={`badge badge--${display.tone}`}>{display.label}</span>}
      />

      {revealed && (
        <Card className="state" role="alert" style={{ background: 'var(--brand-surface)', borderColor: 'var(--brand-border)' }}>
          <CardBody>
            <p style={{ margin: '0 0 0.5rem', color: 'var(--brand-dark)' }}>
              <strong>New secret</strong> — copy it now. It cannot be retrieved again.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <code style={{ wordBreak: 'break-all', userSelect: 'all', background: '#FFFFFF', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flex: 1, minWidth: '240px' }}>
                {revealed}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="btn btn--small"
                onClick={() => navigator.clipboard?.writeText(revealed).catch(() => {})}
              >
                Copy
              </Button>
            </div>
            <div>
              <Button type="button" variant="primary" size="sm" className="btn" onClick={() => setRevealed(null)}>
                I&rsquo;ve stored it securely
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {actionError && <p className="state state--error" role="alert">{actionError}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Connector details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="detail-grid">
            <dt>Secret prefix</dt><dd><code>{c.secretPrefix}…</code></dd>
            <dt>Version</dt><dd>{c.version ?? '—'}</dd>
            <dt>Scopes</dt><dd>{(c.scopes ?? []).join(', ') || '—'}</dd>
            <dt>Tally company</dt><dd>{c.tallyCompanyName ?? '—'}</dd>
            <dt>Last heartbeat</dt><dd>{c.lastHeartbeatAt ? formatDateTime(c.lastHeartbeatAt) : 'Never'}</dd>
            <dt>Last poll</dt><dd>{c.lastPollAt ? formatDateTime(c.lastPollAt) : 'Never'}</dd>
            <dt>Last successful sync</dt><dd>{c.lastSuccessfulSyncAt ? formatDateTime(c.lastSuccessfulSyncAt) : 'Never'}</dd>
            <dt>Tally available (last heartbeat)</dt><dd>{c.lastTallyAvailable === null ? '—' : (c.lastTallyAvailable ? 'Yes' : 'No')}</dd>
            <dt>Last error</dt><dd>{c.lastErrorCode ? `${c.lastErrorCode} — ${c.lastErrorMessage ?? ''}` : '—'}</dd>
            <dt>Created</dt><dd>{formatDateTime(c.createdAt)}</dd>
            <dt>Updated</dt><dd>{formatDateTime(c.updatedAt)}</dd>
            {c.revokedAt && (<><dt>Revoked</dt><dd>{formatDateTime(c.revokedAt)}</dd></>)}
          </dl>
        </CardBody>
      </Card>

      {canManage && c.status === 'ACTIVE' && (
        <Card>
          <CardBody>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <Button type="button" variant="outline" className="btn" onClick={() => setConfirmAction({ type: 'rotate' })}>
                Rotate secret
              </Button>
              <Button type="button" variant="danger" className="btn btn--danger" onClick={() => setConfirmAction({ type: 'revoke' })}>
                Revoke connector
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'revoke' ? 'Revoke connector?' : 'Rotate connector secret?'}
        message={confirmAction?.type === 'revoke'
          ? `"${c.name}" will stop being able to authenticate immediately.`
          : `A new secret will be generated for "${c.name}". The current secret will stop working immediately.`}
        confirmLabel={confirmAction?.type === 'revoke' ? 'Revoke' : 'Rotate'}
        danger={confirmAction?.type === 'revoke'}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
