import { useEffect, useState } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { can } from '../../permissions/permissions.js';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../../components/states.jsx';
import TallyApiKeysSection from './TallyApiKeysSection.jsx';
import {
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Button,
  FormField,
  TextInput,
  Select,
  DefinitionList,
  DefinitionItem,
} from '../../design-system/index.js';

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
    <div className="page-container" style={{ display: 'grid', gap: '1.5rem' }}>
      <PageHeader title="Tally integration" subtitle="Connect this business to a Tally instance and map invoices to ledgers." />
      {notice && <p className="state" role="status">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Connection status</CardTitle>
        </CardHeader>
        <CardBody>
          <DefinitionList>
            <DefinitionItem
              label="Last connection"
              value={<StatusBadge status={state.data.lastConnectionStatus === 'SUCCESS' ? 'SYNCED' : state.data.lastConnectionStatus === 'FAILED' ? 'FAILED' : 'NOT_SYNCED'} />}
            />
            <DefinitionItem
              label="Last connected at"
              value={state.data.lastConnectedAt ? new Date(state.data.lastConnectedAt).toLocaleString() : '—'}
            />
          </DefinitionList>

          <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {canConfigure && (
              <Button type="button" variant="outline" disabled={testing} onClick={testConnection}>
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            )}
            {testResult && (
              <p className={`state ${testResult.connected ? '' : 'state--error'}`} role="status" style={{ margin: 0, padding: '0.5rem 1rem' }}>
                {testResult.connected
                  ? `Connected${testResult.companyName ? ` to ${testResult.companyName}` : ''} (${testResult.responseTimeMs}ms)`
                  : (testResult.message ?? 'Not connected')}
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {!canConfigure && (
        <p className="muted" style={{ margin: 0 }}>
          You have read-only access to Tally status. Only a Business administrator can change this configuration.
        </p>
      )}

      {canConfigure && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardBody>
            <form className="form" onSubmit={save} style={{ display: 'grid', gap: '1.5rem' }}>
              <div style={{ display: 'grid', gap: '1rem' }}>
                <label className="field field--inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.enabled} onChange={set('enabled')} />
                  <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Enable Tally integration</span>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                  <FormField label="Connection type">
                    <Select value={form.connectionType} onChange={set('connectionType')}>
                      <option value="LOCAL_TALLY">On-premise Tally (reachable over the network)</option>
                      <option value="REMOTE_TALLY">Remote / hosted Tally</option>
                    </Select>
                  </FormField>

                  <FormField label="Tally endpoint URL *">
                    <TextInput type="text" value={form.baseUrl} onChange={set('baseUrl')} placeholder="http://192.168.1.50:9000" maxLength={2048} />
                  </FormField>

                  <FormField label="Company name">
                    <TextInput type="text" value={form.companyName} onChange={set('companyName')} maxLength={200} />
                  </FormField>

                  <FormField label="Voucher type">
                    <TextInput type="text" value={form.defaultVoucherType} onChange={set('defaultVoucherType')} maxLength={60} />
                  </FormField>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--ink)', margin: '0 0 1rem' }}>Ledger mapping</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <FormField label="Sales ledger *">
                    <TextInput type="text" value={form.salesLedger} onChange={set('salesLedger')} maxLength={200} />
                  </FormField>
                  <FormField label="CGST ledger">
                    <TextInput type="text" value={form.cgstLedger} onChange={set('cgstLedger')} maxLength={200} />
                  </FormField>
                  <FormField label="SGST ledger">
                    <TextInput type="text" value={form.sgstLedger} onChange={set('sgstLedger')} maxLength={200} />
                  </FormField>
                  <FormField label="IGST ledger">
                    <TextInput type="text" value={form.igstLedger} onChange={set('igstLedger')} maxLength={200} />
                  </FormField>
                  <FormField label="Round-off ledger">
                    <TextInput type="text" value={form.roundOffLedger} onChange={set('roundOffLedger')} maxLength={200} />
                  </FormField>
                  <FormField label="Discount ledger">
                    <TextInput type="text" value={form.discountLedger} onChange={set('discountLedger')} maxLength={200} />
                  </FormField>
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--ink)', margin: '0 0 1rem' }}>Connection options</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                  <FormField label="Timeout (ms)">
                    <TextInput type="number" min={1000} max={60000} value={form.timeoutMs} onChange={set('timeoutMs')} />
                  </FormField>
                  <FormField label="Max retry attempts">
                    <TextInput type="number" min={1} max={10} value={form.retryMaxAttempts} onChange={set('retryMaxAttempts')} />
                  </FormField>
                  <FormField label="Auth username">
                    <TextInput type="text" value={form.authUsername} onChange={set('authUsername')} maxLength={200} />
                  </FormField>
                  <FormField label={`Auth password ${state.data.hasPassword ? '(set — leave blank to keep)' : ''}`}>
                    <TextInput type="password" value={form.authPassword} onChange={set('authPassword')} placeholder={state.data.hasPassword ? '••••••••' : ''} maxLength={500} />
                  </FormField>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save configuration'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {canViewApiKeys && <TallyApiKeysSection />}
    </div>
  );
}
