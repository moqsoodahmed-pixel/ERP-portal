import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';

const SCOPES = ['tally:company:read', 'tally:customer:read', 'tally:product:read', 'tally:invoice:read', 'tally:sync'];

/**
 * Phase 13: lets a Business/Master admin issue API keys for an external Tally/TDL integration to call
 * this ERP directly (the opposite direction from the ERP -> Tally sync configured above). The raw key is
 * shown exactly once, right after creation or rotation, and is never stored in this component's state
 * past that — leaving the page (or creating/rotating another key) makes it unrecoverable, matching the
 * backend's "never retrievable again" guarantee. It is never written to localStorage/sessionStorage.
 */
export default function TallyApiKeysSection() {
  const { user } = useAuth();
  const canCreate = can(user, 'tally.api_keys.create');
  const canRevoke = can(user, 'tally.api_keys.revoke');
  const canRotate = can(user, 'tally.api_keys.rotate');

  const [keys, setKeys] = useState(null);
  const [error, setError] = useState(null);
  const [revealedKey, setRevealedKey] = useState(null); // { name, key } — once, in memory only
  const [form, setForm] = useState({ name: '', scopes: [], expiresAt: '' });
  const [creating, setCreating] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'revoke'|'rotate', id, name }

  const load = () => {
    api.get('/tally/api-keys').then(({ data }) => setKeys(data)).catch((err) => setError(err.message ?? 'Could not load API keys'));
  };
  useEffect(load, []);

  const toggleScope = (scope) => {
    setForm((f) => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter((s) => s !== scope) : [...f.scopes, scope] }));
  };

  const create = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const { data } = await api.post('/tally/api-keys', {
        name: form.name, scopes: form.scopes, ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      });
      setRevealedKey({ name: data.name, key: data.key });
      setForm({ name: '', scopes: [], expiresAt: '' });
      load();
    } catch (err) {
      setError(err.message ?? 'Could not create API key');
    } finally {
      setCreating(false);
    }
  };

  const runConfirmedAction = async () => {
    const { type, id } = confirmAction;
    setConfirmAction(null);
    try {
      if (type === 'revoke') {
        await api.post(`/tally/api-keys/${id}/revoke`);
        load();
      } else {
        const { data } = await api.post(`/tally/api-keys/${id}/rotate`);
        setRevealedKey({ name: data.name, key: data.key });
        load();
      }
    } catch (err) {
      setError(err.message ?? 'Action failed');
    }
  };

  return (
    <section className="card">
      <h2>Tally API keys</h2>
      <p className="muted">
        Issue a key so an external Tally/TDL integration can call this ERP directly (Tally → ERP), separate from the Tally connection configured above (ERP → Tally).
        See the integration handoff document for endpoint details.
      </p>
      {error && <p className="state state--error" role="alert">{error}</p>}

      {revealedKey && (
        <div className="state" role="alert">
          <p><strong>{revealedKey.name}</strong> — copy this key now. It will not be shown again.</p>
          <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{revealedKey.key}</code>
          <div className="dialog__actions">
            <button type="button" className="btn" onClick={() => setRevealedKey(null)}>I&rsquo;ve stored it securely</button>
          </div>
        </div>
      )}

      {keys === null && !error && <p className="muted">Loading…</p>}
      {keys && keys.length === 0 && <p className="muted">No API keys yet.</p>}
      {keys && keys.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Prefix</th><th>Status</th><th>Scopes</th><th>Last used</th><th>Expires</th>{(canRevoke || canRotate) && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td><code>{k.keyPrefix}…</code></td>
                <td><StatusBadge status={k.status} /></td>
                <td>{k.scopes.join(', ') || '—'}</td>
                <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</td>
                <td>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</td>
                {(canRevoke || canRotate) && (
                  <td>
                    {k.status === 'ACTIVE' && canRotate && (
                      <button type="button" className="btn btn--small" onClick={() => setConfirmAction({ type: 'rotate', id: k.id, name: k.name })}>Rotate</button>
                    )}
                    {k.status === 'ACTIVE' && canRevoke && (
                      <button type="button" className="btn btn--small btn--danger" onClick={() => setConfirmAction({ type: 'revoke', id: k.id, name: k.name })}>Revoke</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canCreate && (
        <form onSubmit={create} style={{ marginTop: '1rem' }}>
          <h3>Create a new key</h3>
          <label className="field">
            <span>Name *</span>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} required placeholder="e.g. Tally TDL — Mumbai office" />
          </label>
          <fieldset className="field">
            <legend>Scopes</legend>
            {SCOPES.map((scope) => (
              <label key={scope} style={{ display: 'block' }}>
                <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggleScope(scope)} /> {scope}
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>Expires (optional)</span>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
          </label>
          <div className="dialog__actions">
            <button type="submit" className="btn btn--primary" disabled={creating || form.scopes.length === 0}>{creating ? 'Creating…' : 'Create API key'}</button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === 'revoke' ? 'Revoke API key?' : 'Rotate API key?'}
        message={confirmAction?.type === 'revoke'
          ? `"${confirmAction?.name}" will stop working immediately. Any integration using it must be updated with a new key.`
          : `A new secret will be generated for "${confirmAction?.name}". The current secret will stop working immediately.`}
        confirmLabel={confirmAction?.type === 'revoke' ? 'Revoke' : 'Rotate'}
        danger={confirmAction?.type === 'revoke'}
        onConfirm={runConfirmedAction}
        onCancel={() => setConfirmAction(null)}
      />
    </section>
  );
}
