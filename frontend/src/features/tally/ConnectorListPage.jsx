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
    <>
      <PageHeader title="Tally connectors" subtitle="Windows Tally Connector credentials for this tenant. A connector authenticates with its own secret — never the ERP login or a Tally Public API key." />

      {revealed && (
        <section className="card state" role="alert">
          <p><strong>{revealed.name}</strong> — copy this connector secret now. It cannot be retrieved again; losing it means rotating a new one.</p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{revealed.connectorSecret}</code>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => navigator.clipboard?.writeText(revealed.connectorSecret).catch(() => {})}
            >
              Copy
            </button>
          </div>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setRevealed(null)}>I&rsquo;ve stored it securely</button>
          </div>
        </section>
      )}

      <section className="card">
        {actionError && <p className="state state--error" role="alert">{actionError}</p>}
        {status === 'loading' && <LoadingState />}
        {status === 'error' && <ErrorState error={error} onRetry={reload} />}
        {status === 'ready' && data.length === 0 && <EmptyState title="No connectors registered" hint="Register a connector below to let a Windows machine with Tally poll for sync jobs." />}
        {status === 'ready' && data.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Version</th><th>Tally company</th><th>Last heartbeat</th><th>Created</th><th>Updated</th>{canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const display = deriveConnectorDisplayStatus(c);
                return (
                  <tr key={c.id}>
                    <td><Link to={`/master/tally-connectors/${c.id}`}>{c.name}</Link></td>
                    <td><span className={`badge badge--${display.tone}`}>{display.label}</span></td>
                    <td>{c.version ?? '—'}</td>
                    <td>{c.tallyCompanyName ?? '—'}</td>
                    <td>{c.lastHeartbeatAt ? formatDateTime(c.lastHeartbeatAt) : 'Never'}</td>
                    <td>{formatDateTime(c.createdAt)}</td>
                    <td>{formatDateTime(c.updatedAt)}</td>
                    {canManage && (
                      <td>
                        {c.status === 'ACTIVE' && (
                          <>
                            <button type="button" className="btn btn--small" onClick={() => setConfirmAction({ type: 'rotate', id: c.id, name: c.name })}>Rotate</button>{' '}
                            <button type="button" className="btn btn--small btn--danger" onClick={() => setConfirmAction({ type: 'revoke', id: c.id, name: c.name })}>Revoke</button>
                          </>
                        )}
                        {c.status !== 'ACTIVE' && '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {canManage && (
        <section className="card">
          <h2>Register a new connector</h2>
          {formError && <p className="state state--error" role="alert">{formError}</p>}
          <form onSubmit={register}>
            <label className="field">
              <span>Name *</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required placeholder="e.g. Accounts office — Windows PC" />
            </label>
            <div className="dialog__actions">
              <button type="submit" className="btn btn--primary" disabled={registering || !name.trim()}>{registering ? 'Registering…' : 'Register connector'}</button>
            </div>
          </form>
        </section>
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
    </>
  );
}
