import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
  FormField,
  TextInput,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
} from '../../design-system/index.js';

const SCOPES = ['tally:bill:sync', 'tally:company:read', 'tally:customer:read', 'tally:product:read', 'tally:invoice:read', 'tally:sync'];

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
      setRevealedKey({ name: data.name, key: data.key, secret: data.secret });
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
        setRevealedKey({ name: data.name, key: data.key, secret: data.secret });
        load();
      }
    } catch (err) {
      setError(err.message ?? 'Action failed');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tally API keys</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="muted" style={{ margin: '0 0 1.25rem', lineHeight: 1.5 }}>
          Issue a key so an external Tally/TDL integration can call this ERP directly (Tally → ERP), separate from the Tally connection configured above (ERP → Tally).
          See the integration handoff document for endpoint details.
        </p>
        {error && <p className="state state--error" role="alert" style={{ marginBottom: '1.25rem' }}>{error}</p>}

        {revealedKey && (
          <div className="state" role="alert" style={{ marginBottom: '1.5rem', background: 'var(--brand-surface)', borderColor: 'var(--brand-border)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ margin: '0 0 0.5rem', color: 'var(--brand-dark)' }}>
              <strong>{revealedKey.name}</strong> — copy these credentials now. They will not be shown again.
            </p>
            <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem' }}><strong>API Key:</strong></p>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <code style={{ wordBreak: 'break-all', userSelect: 'all', background: '#FFFFFF', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flex: 1, minWidth: '240px' }}>
                {revealedKey.key}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard?.writeText(revealedKey.key).catch(() => {})}
              >
                Copy Key
              </Button>
            </div>
            {revealedKey.secret && (
              <>
                <p style={{ margin: '0 0 0.25rem', fontSize: '0.875rem' }}><strong>Secret Key (for HMAC request signing):</strong></p>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <code style={{ wordBreak: 'break-all', userSelect: 'all', background: '#FFFFFF', padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', flex: 1, minWidth: '240px' }}>
                    {revealedKey.secret}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => navigator.clipboard?.writeText(revealedKey.secret).catch(() => {})}
                  >
                    Copy Secret
                  </Button>
                </div>
              </>
            )}
            <div>
              <Button type="button" variant="primary" size="sm" onClick={() => setRevealedKey(null)}>
                I&rsquo;ve stored them securely
              </Button>
            </div>
          </div>
        )}

        {keys === null && !error && <p className="muted">Loading…</p>}
        {keys && keys.length === 0 && <p className="muted">No API keys yet.</p>}
        {keys && keys.length > 0 && (
          <Table className="table">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Prefix</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Scopes</TableHeaderCell>
                <TableHeaderCell>Last used</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                {(canRevoke || canRotate) && <TableHeaderCell>Actions</TableHeaderCell>}
              </TableRow>
            </TableHead>
            <tbody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell style={{ fontWeight: 600 }}>{k.name}</TableCell>
                  <TableCell><code>{k.keyPrefix}…</code></TableCell>
                  <TableCell><StatusBadge status={k.status} /></TableCell>
                  <TableCell>{k.scopes.join(', ') || '—'}</TableCell>
                  <TableCell>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</TableCell>
                  <TableCell>{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                  {(canRevoke || canRotate) && (
                    <TableCell>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {k.status === 'ACTIVE' && canRotate && (
                          <Button type="button" variant="outline" size="sm" className="btn btn--small" onClick={() => setConfirmAction({ type: 'rotate', id: k.id, name: k.name })}>
                            Rotate
                          </Button>
                        )}
                        {k.status === 'ACTIVE' && canRevoke && (
                          <Button type="button" variant="danger" size="sm" className="btn btn--small btn--danger" onClick={() => setConfirmAction({ type: 'revoke', id: k.id, name: k.name })}>
                            Revoke
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}

        {canCreate && (
          <form onSubmit={create} style={{ marginTop: '1.75rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem', display: 'grid', gap: '1.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--ink)' }}>Create a new key</h3>
            <FormField label="Name *">
              <TextInput type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} maxLength={120} required placeholder="e.g. Tally TDL — Mumbai office" />
            </FormField>

            <fieldset style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
              <legend style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--ink)', padding: '0 0.5rem' }}>Scopes</legend>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.625rem' }}>
                {SCOPES.map((scope) => (
                  <label key={scope} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={form.scopes.includes(scope)} onChange={() => toggleScope(scope)} />
                    <code>{scope}</code>
                  </label>
                ))}
              </div>
            </fieldset>

            <FormField label="Expires (optional)">
              <TextInput type="date" value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
            </FormField>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="primary" disabled={creating || form.scopes.length === 0}>
                {creating ? 'Creating…' : 'Create API key'}
              </Button>
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
      </CardBody>
    </Card>
  );
}
