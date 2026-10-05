import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import TallyApiKeysSection from './TallyApiKeysSection.jsx';

const BLANK = {
  enabled: false, connectionType: 'LOCAL_TALLY', baseUrl: '', companyName: '', defaultVoucherType: 'Sales',
  salesLedger: '', cgstLedger: '', sgstLedger: '', igstLedger: '', roundOffLedger: '', discountLedger: '',
  timeoutMs: 10000, retryMaxAttempts: 3, authUsername: '', authPassword: '',
};

export default function TallyPage() {
  const { user } = useAuth();
  const canConfigure = can(user, 'tally.configure');
  const canViewApiKeys = can(user, 'tally.api_keys.view');
  const [state, setState] = useState({ status: 'loading' });
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const load = () => {
    api.get('/tally/config')
      .then(({ data }) => {
        setState({ status: 'ready', data });
        setForm({
          enabled: data.enabled ?? false, connectionType: data.connectionType ?? 'LOCAL_TALLY', baseUrl: data.baseUrl ?? '',
          companyName: data.companyName ?? '', defaultVoucherType: data.defaultVoucherType ?? 'Sales',
          salesLedger: data.salesLedger ?? '', cgstLedger: data.cgstLedger ?? '', sgstLedger: data.sgstLedger ?? '',
          igstLedger: data.igstLedger ?? '', roundOffLedger: data.roundOffLedger ?? '', discountLedger: data.discountLedger ?? '',
          timeoutMs: data.timeoutMs ?? 10000, retryMaxAttempts: data.retryPolicy?.maxAttempts ?? 3,
          authUsername: data.authUsername ?? '', authPassword: '',
        });
      })
      .catch((error) => setState({ status: 'error', error }));
  };

  useEffect(load, []);

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      // The password field is only sent when the admin actually typed a new value — it is never
      // round-tripped as plaintext from the server, so leaving it blank keeps whatever is already stored.
      const { authPassword, ...rest } = form;
      const body = { ...rest, ...(authPassword ? { authPassword } : {}) };
      await api.post('/tally/config', body);
      setNotice('Tally configuration saved.');
      load();
    } catch (err) {
      setNotice(err.message ?? 'Could not save Tally configuration');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { data } = await api.post('/tally/test-connection');
      setTestResult(data);
      load();
    } catch (err) {
      setTestResult({ connected: false, message: err.message ?? 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  return (
    <>
      <PageHeader title="Tally integration" subtitle="Connect this business to a Tally instance and map invoices to ledgers." />
      {notice && <p className="state" role="status">{notice}</p>}

      <section className="card">
        <h2>Connection status</h2>
        <dl className="definition-list">
          <div><dt>Last connection</dt><dd><StatusBadge status={state.data.lastConnectionStatus === 'SUCCESS' ? 'SYNCED' : state.data.lastConnectionStatus === 'FAILED' ? 'FAILED' : 'NOT_SYNCED'} /></dd></div>
          <div><dt>Last connected at</dt><dd>{state.data.lastConnectedAt ? new Date(state.data.lastConnectedAt).toLocaleString() : '—'}</dd></div>
        </dl>
        {canConfigure && (
          <button type="button" className="btn" disabled={testing} onClick={testConnection}>
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        )}
        {testResult && (
          <p className={`state ${testResult.connected ? '' : 'state--error'}`} role="status">
            {testResult.connected ? `Connected${testResult.companyName ? ` to ${testResult.companyName}` : ''} (${testResult.responseTimeMs}ms)` : (testResult.message ?? 'Not connected')}
          </p>
        )}
      </section>

      {!canConfigure && <p className="muted">You have read-only access to Tally status. Only a Business administrator can change this configuration.</p>}

      {canConfigure && (
        <form className="card" onSubmit={save}>
          <h2>Configuration</h2>
          <label className="field">
            <span>Enabled</span>
            <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
          </label>
          <label className="field">
            <span>Connection type</span>
            <select value={form.connectionType} onChange={set('connectionType')}>
              <option value="LOCAL_TALLY">On-premise Tally (reachable over the network)</option>
              <option value="REMOTE_TALLY">Remote / hosted Tally</option>
            </select>
          </label>
          <label className="field">
            <span>Tally endpoint URL *</span>
            <input type="text" value={form.baseUrl} onChange={set('baseUrl')} placeholder="http://192.168.1.50:9000" maxLength={2048} />
          </label>
          <label className="field">
            <span>Company name</span>
            <input type="text" value={form.companyName} onChange={set('companyName')} maxLength={200} />
          </label>
          <label className="field">
            <span>Voucher type</span>
            <input type="text" value={form.defaultVoucherType} onChange={set('defaultVoucherType')} maxLength={60} />
          </label>

          <h3>Ledger mapping</h3>
          <label className="field"><span>Sales ledger *</span><input type="text" value={form.salesLedger} onChange={set('salesLedger')} maxLength={200} /></label>
          <label className="field"><span>CGST ledger</span><input type="text" value={form.cgstLedger} onChange={set('cgstLedger')} maxLength={200} /></label>
          <label className="field"><span>SGST ledger</span><input type="text" value={form.sgstLedger} onChange={set('sgstLedger')} maxLength={200} /></label>
          <label className="field"><span>IGST ledger</span><input type="text" value={form.igstLedger} onChange={set('igstLedger')} maxLength={200} /></label>
          <label className="field"><span>Round-off ledger</span><input type="text" value={form.roundOffLedger} onChange={set('roundOffLedger')} maxLength={200} /></label>
          <label className="field"><span>Discount ledger</span><input type="text" value={form.discountLedger} onChange={set('discountLedger')} maxLength={200} /></label>

          <h3>Connection options</h3>
          <label className="field"><span>Timeout (ms)</span><input type="number" min={1000} max={60000} value={form.timeoutMs} onChange={set('timeoutMs')} /></label>
          <label className="field"><span>Max retry attempts</span><input type="number" min={1} max={10} value={form.retryMaxAttempts} onChange={set('retryMaxAttempts')} /></label>
          <label className="field"><span>Auth username</span><input type="text" value={form.authUsername} onChange={set('authUsername')} maxLength={200} /></label>
          <label className="field">
            <span>Auth password {state.data.hasPassword ? '(set — leave blank to keep)' : ''}</span>
            <input type="password" value={form.authPassword} onChange={set('authPassword')} placeholder={state.data.hasPassword ? '••••••••' : ''} maxLength={500} />
          </label>

          <div className="dialog__actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button>
          </div>
        </form>
      )}

      {canViewApiKeys && <TallyApiKeysSection />}
    </>
  );
}
