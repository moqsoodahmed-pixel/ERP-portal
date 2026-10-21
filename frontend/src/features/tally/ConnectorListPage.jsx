import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/PageHeader.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { ErrorState, LoadingState, EmptyState } from '../../components/states.jsx';
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
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '../../design-system/index.js';

/**
 * Phase 16.1 — Windows Tally Connector registry (spec Step 25). Lists this tenant's registered connectors
 * and lets a Master Admin / Business Admin (tally.connector.manage) register a new one, rotate its secret,
 * or revoke it. The raw connector secret is returned by the backend exactly once (on register/rotate) and
 * is held only in this component's in-memory state — never written to localStorage/sessionStorage/the URL,
 * and it is gone for good once the reveal panel is dismissed (matching TallyApiKeysSection.jsx's pattern).
 * The real access control is the backend's 403 on these endpoints; hiding actions here is UX only.
 */
export default function ConnectorListPage() {
  const { user } = useAuth();
  const canManage = can(user, 'tally.connector.manage');

  const { status, data, error, reload } = useFetch('/tally/connectors');
  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [formError, setFormError] = useState(null);
  const [revealed, setRevealed] = useState(null); // { name, connectorSecret } — once, in memory only
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'revoke'|'rotate', id, name }
  const [actionError, setActionError] = useState(null);

  const register = async (e) => {
    e.preventDefault();
    setRegistering(true);
    setFormError(null);
    try {
      const { data: created } = await api.post('/tally/connectors', { name: name.trim() });
      setRevealed({ name: created.name, connectorSecret: created.connectorSecret });
      setName('');
      reload();
    } catch (err) {
      setFormError(err.message ?? 'Could not register connector');
    } finally {
      setRegistering(false);
    }
  };

  const runConfirmedAction = async () => {
    const { type, id } = confirmAction;
    setConfirmAction(null);
    setActionError(null);
    try {
      if (type === 'revoke') {
        await api.post(`/tally/connectors/${id}/revoke`);
        reload();
      } else {
        const { data: rotated } = await api.post(`/tally/connectors/${id}/rotate`);
        setRevealed({ name: rotated.name, connectorSecret: rotated.connectorSecret });
        reload();
      }
    } catch (err) {
      setActionError(err.message ?? 'Action failed');
    }
  };

  return (
    <div className="page-container" style={{ display: 'grid', gap: '1.5rem' }}>
      <PageHeader
        title="Tally connectors"
        subtitle="Windows Tally Connector credentials for this tenant. A connector authenticates with its own secret — never the ERP login or a Tally Public API key."
      />

      {revealed && (
        <Card className="state" role="alert" style={{ background: 'var(--brand-surface)', borderColor: 'var(--brand-border)' }}>
          <CardBody>
            <p style={{ margin: '0 0 0.5rem', color: 'var(--brand-dark)' }}>
              <strong>{revealed.name}</strong> — copy this connector secret now. It cannot be retrieved again; losing it means rotating a new one.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <code style={{ wordBreak: 'break-all', userSelect: 'all', background: '#FFFFFF', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flex: 1, minWidth: '240px' }}>
                {revealed.connectorSecret}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="btn btn--small"
                onClick={() => navigator.clipboard?.writeText(revealed.connectorSecret).catch(() => {})}
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

      <Card>
        <CardBody style={{ padding: 0 }}>
          {actionError && <p className="state state--error" role="alert" style={{ margin: '1rem' }}>{actionError}</p>}
          {status === 'loading' && <LoadingState />}
          {status === 'error' && <ErrorState error={error} onRetry={reload} />}
          {status === 'ready' && data.length === 0 && (
            <EmptyState title="No connectors registered" hint="Register a connector below to let a Windows machine with Tally poll for sync jobs." />
          )}
          {status === 'ready' && data.length > 0 && (
            <Table className="data-table">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Version</TableHeaderCell>
                  <TableHeaderCell>Tally company</TableHeaderCell>
                  <TableHeaderCell>Last heartbeat</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell>Updated</TableHeaderCell>
                  {canManage && <TableHeaderCell>Actions</TableHeaderCell>}
                </TableRow>
              </TableHead>
              <tbody>
                {data.map((c) => {
                  const display = deriveConnectorDisplayStatus(c);
                  return (
                    <TableRow key={c.id}>
                      <TableCell style={{ fontWeight: 600 }}>
                        <Link to={`/master/tally-connectors/${c.id}`} style={{ color: 'var(--brand)', textDecoration: 'none' }}>
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell><span className={`badge badge--${display.tone}`}>{display.label}</span></TableCell>
                      <TableCell>{c.version ?? '—'}</TableCell>
                      <TableCell>{c.tallyCompanyName ?? '—'}</TableCell>
                      <TableCell>{c.lastHeartbeatAt ? formatDateTime(c.lastHeartbeatAt) : 'Never'}</TableCell>
                      <TableCell>{formatDateTime(c.createdAt)}</TableCell>
                      <TableCell>{formatDateTime(c.updatedAt)}</TableCell>
                      {canManage && (
                        <TableCell>
                          {c.status === 'ACTIVE' && (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <Button type="button" variant="outline" size="sm" className="btn btn--small" onClick={() => setConfirmAction({ type: 'rotate', id: c.id, name: c.name })}>
                                Rotate
                              </Button>
                              <Button type="button" variant="danger" size="sm" className="btn btn--small btn--danger" onClick={() => setConfirmAction({ type: 'revoke', id: c.id, name: c.name })}>
                                Revoke
                              </Button>
                            </div>
                          )}
                          {c.status !== 'ACTIVE' && '—'}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Register a new connector</CardTitle>
          </CardHeader>
          <CardBody>
            {formError && <p className="state state--error" role="alert" style={{ marginBottom: '1rem' }}>{formError}</p>}
            <form onSubmit={register} style={{ display: 'grid', gap: '1.25rem' }}>
              <label className="field">
                <span>Name *</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="e.g. Accounts office — Windows PC"
                  className="input"
                />
              </label>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="submit" variant="primary" disabled={registering || !name.trim()} className="btn btn--primary">
                  {registering ? 'Registering…' : 'Register connector'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'revoke' ? 'Revoke connector?' : 'Rotate connector secret?'}
        message={confirmAction?.type === 'revoke'
          ? `"${confirmAction?.name}" will stop being able to authenticate immediately. Any Windows machine using it must be re-registered.`
          : `A new secret will be generated for "${confirmAction?.name}". The current secret will stop working immediately.`}
        confirmLabel={confirmAction?.type === 'revoke' ? 'Revoke' : 'Rotate'}
        danger={confirmAction?.type === 'revoke'}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
