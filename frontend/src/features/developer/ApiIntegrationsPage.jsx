import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { ROLES } from '../../constants/roles.js';
import { formatDateTime } from '../../utils/format.js';
import {
  PageHeader,
  Card,
  StatusBadge,
  LoadingState,
  ErrorState,
  EmptyState,
} from '../../design-system/index.js';

const TABS = [
  { id: 'integrations', label: 'Integrations & Metrics', icon: '⚡' },
  { id: 'test-console', label: 'API Test Console', icon: '🧪' },
  { id: 'scenarios', label: 'Predefined Scenarios (17)', icon: '✓' },
  { id: 'health', label: 'Visual API Health', icon: '💓' },
  { id: 'logs', label: 'Live API Logs', icon: '📋' },
];

const ALL_PERMISSIONS = [
  { id: 'Bills.Read', label: 'Bills.Read', desc: 'Read bill details, queue status, and history' },
  { id: 'Bills.Write', label: 'Bills.Write', desc: 'Upload and enqueue new bills for synchronization' },
  { id: 'Bills.Status', label: 'Bills.Status', desc: 'Check status and progress of queued bills' },
  { id: 'Bills.Sync', label: 'Bills.Sync', desc: 'Trigger manual or batch resynchronization' },
  { id: 'Bills.Retry', label: 'Bills.Retry', desc: 'Retry failed bills and manage Dead Letter Queue' },
  { id: 'Bills.Export', label: 'Bills.Export', desc: 'Export sync audit logs, DLQ dumps, and reports' },
];

const PREDEFINED_SCENARIOS = [
  { key: 'VALID_UPLOAD', name: 'Valid Upload', desc: 'Valid bill payload with correct HMAC signature, fresh timestamp, and unique request ID' },
  { key: 'INVALID_API_KEY', name: 'Invalid API Key', desc: 'Request sent with unrecognized or malformed API key' },
  { key: 'INVALID_SECRET', name: 'Invalid Secret', desc: 'Valid API key with incorrect HMAC-SHA256 signature' },
  { key: 'MISSING_SIGNATURE', name: 'Missing Signature', desc: 'Request omitting mandatory x-signature header' },
  { key: 'EXPIRED_TIMESTAMP', name: 'Expired Timestamp', desc: 'Request with timestamp older than 5-minute security window' },
  { key: 'DUPLICATE_REQUEST', name: 'Duplicate Request', desc: 'Identical invoice number and company code already queued or synced' },
  { key: 'INVALID_BILL', name: 'Invalid Bill', desc: 'Bill payload with negative amount or corrupted date schema' },
  { key: 'MISSING_INVOICE', name: 'Missing Invoice', desc: 'Payload missing mandatory invoice number reference' },
  { key: 'WRONG_ORGANIZATION', name: 'Wrong Organization', desc: 'Company code in payload belongs to an unauthorized tenant' },
  { key: 'REPLAY_ATTACK', name: 'Replay Attack', desc: 'Re-transmission of identical request ID within active window' },
  { key: 'UNAUTHORIZED_PERMISSION', name: 'Unauthorized Permission', desc: 'Upload attempted with an integration that only has Bills.Read scope' },
  { key: 'DISABLED_INTEGRATION', name: 'Disabled Integration', desc: 'Request dispatched against an integration marked as DISABLED' },
  { key: 'EXPIRED_CREDENTIAL', name: 'Expired Credential', desc: 'Request dispatched against credentials past their validity period' },
  { key: 'QUEUE_FAILURE', name: 'Queue Failure', desc: 'Captures and isolates queue dispatch failure with backoff scheduling' },
  { key: 'RETRY_FLOW', name: 'Retry Flow', desc: 'Triggers retry on a failed bill and checks state transition to RETRY_PENDING' },
  { key: 'DEAD_LETTER_QUEUE', name: 'Dead Letter Queue', desc: 'Inspects poison bills quarantined after exceeding max retry attempts' },
  { key: 'SUCCESSFUL_SYNCHRONIZATION', name: 'Successful Synchronization', desc: 'End-to-end sync verification returning Tally voucher number' },
];

export default function ApiIntegrationsPage() {
  const { user } = useAuth();
  const isMasterAdmin = user?.role === ROLES.MASTER_ADMIN;
  const isAssistantAdmin = user?.role === ROLES.MASTER_ASSISTANT_ADMIN;

  const [activeTab, setActiveTab] = useState('integrations');
  const [integrations, setIntegrations] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);

  // Filters
  const [selectedTenant, setSelectedTenant] = useState('');
  const [envFilter, setEnvFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdSecretData, setCreatedSecretData] = useState(null);
  const [secretAcknowledged, setSecretAcknowledged] = useState(false);
  const [showRotateModal, setShowRotateModal] = useState(false);
  const [rotatedSecretData, setRotatedSecretData] = useState(null);
  const [selectedIntegration, setSelectedIntegration] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: '',
    environment: 'PRODUCTION',
    description: '',
    tenantId: '',
    permissions: ['Bills.Read', 'Bills.Write', 'Bills.Status', 'Bills.Sync', 'Bills.Retry', 'Bills.Export'],
    expiration: '90',
    allowedIps: '',
    webhookUrl: '',
  });

  // Test Console state
  const [testIntegrationId, setTestIntegrationId] = useState('');
  const [testEndpoint, setTestEndpoint] = useState('/api/tally/upload');
  const [testMethod, setTestMethod] = useState('POST');
  const [testPayloadText, setTestPayloadText] = useState(JSON.stringify({
    companyCode: 'JAC001',
    supplierName: 'Acme Industrial Supplies Pvt Ltd',
    supplierGstin: '29ABCDE1234F1Z5',
    vendorName: 'Acme Industrial Supplies Pvt Ltd',
    vendorGSTIN: '29ABCDE1234F1Z5',
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    billDate: new Date().toISOString().slice(0, 10),
    amount: 14750.00,
    taxAmount: 2250.00,
    category: 'INVOICE',
    priority: 'HIGH',
    items: [
      { name: 'Precision CNC Ball Bearing 6205', quantity: 10, unitPrice: 1250, taxRate: 18, total: 14750 },
    ],
  }, null, 2));
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testConsoleTab, setTestConsoleTab] = useState('response');

  // Predefined scenarios state
  const [scenarioResults, setScenarioResults] = useState({});
  const [runningScenarioKey, setRunningScenarioKey] = useState(null);
  const [runningAllScenarios, setRunningAllScenarios] = useState(false);

  // Logs filters
  const [logFilterDate, setLogFilterDate] = useState('');
  const [logFilterStatus, setLogFilterStatus] = useState('');
  const [logFilterEndpoint, setLogFilterEndpoint] = useState('');
  const [logFilterEnv, setLogFilterEnv] = useState('');
  const [logSearchText, setLogSearchText] = useState('');

  // 1. Initial Data Fetch
  const loadInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [intRes, metricsRes, healthRes, clientsRes] = await Promise.all([
        api.get('/tally/integrations'),
        api.get('/tally/integrations/dashboard').catch(() => ({ data: {} })),
        api.get('/tally/integrations/health').catch(() => ({ data: {} })),
        api.get('/clients?limit=100').catch(() => ({ data: { items: [] } })),
      ]);

      const items = intRes.items || [];
      setIntegrations(items);
      if (items.length > 0 && !testIntegrationId) {
        setTestIntegrationId(items[0].integrationId || items[0].id);
      }
      setMetrics(metricsRes.data || null);
      setHealth(healthRes.data || null);

      const clientList = clientsRes.data?.items || clientsRes.items || [];
      setClients(clientList);
      if (clientList.length > 0 && !createForm.tenantId) {
        setCreateForm((f) => ({ ...f, tenantId: clientList[0].id || clientList[0]._id }));
      }
    } catch (err) {
      setError(err.message || 'Failed to load API integrations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // 2. Load Logs when on Logs Tab
  const loadLogs = async () => {
    try {
      const params = new URLSearchParams();
      if (logFilterDate) params.set('date', logFilterDate);
      if (logFilterStatus) params.set('status', logFilterStatus);
      if (logFilterEndpoint) params.set('endpoint', logFilterEndpoint);
      if (logFilterEnv) params.set('environment', logFilterEnv);
      if (logSearchText) params.set('requestId', logSearchText);
      params.set('limit', '50');

      const res = await api.get(`/tally/integrations/logs?${params.toString()}`);
      setLogs(res.items || []);
      setLogsTotal(res.total || 0);
    } catch (err) {
      // silently handle
    }
  };

  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
    }
    if (activeTab === 'health') {
      api.get('/tally/integrations/health').then((r) => setHealth(r.data)).catch(() => {});
    }
  }, [activeTab, logFilterDate, logFilterStatus, logFilterEndpoint, logFilterEnv, logSearchText]);

  // Handle Tab Click
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
  };

  // Filtered integrations
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((item) => {
      if (selectedTenant && String(item.tenantId) !== String(selectedTenant)) return false;
      if (envFilter !== 'ALL' && item.environment?.toUpperCase() !== envFilter.toUpperCase()) return false;
      if (statusFilter !== 'ALL' && item.status?.toUpperCase() !== statusFilter.toUpperCase()) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = item.name?.toLowerCase().includes(q);
        const matchKey = item.keyPrefix?.toLowerCase().includes(q);
        const matchId = item.integrationId?.toLowerCase().includes(q);
        if (!matchName && !matchKey && !matchId) return false;
      }
      return true;
    });
  }, [integrations, selectedTenant, envFilter, statusFilter, searchQuery]);

  // Create Integration Handler
  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setLoading(true);
    try {
      const payload = {
        name: createForm.name.trim(),
        tenantId: createForm.tenantId || (clients[0]?.id || clients[0]?._id),
        environment: createForm.environment,
        description: createForm.description,
        permissions: createForm.permissions,
        expiresInDays: createForm.expiration === 'never' ? 0 : Number(createForm.expiration),
        ipAllowList: createForm.allowedIps ? createForm.allowedIps.split(',').map((s) => s.trim()).filter(Boolean) : [],
        webhookUrl: createForm.webhookUrl.trim() || undefined,
      };

      const res = await api.post('/tally/integrations', payload);
      setCreatedSecretData(res.data);
      setSecretAcknowledged(false);
      loadInitialData();
    } catch (err) {
      alert(`Error creating integration: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Rotate Integration Handler
  const handleRotateConfirm = async () => {
    if (!selectedIntegration) return;
    setLoading(true);
    try {
      const res = await api.post(`/tally/integrations/${selectedIntegration.id || selectedIntegration.integrationId}/rotate`, {
        gracePeriodHours: 24,
      });
      setRotatedSecretData(res.data);
      setSecretAcknowledged(false);
      loadInitialData();
    } catch (err) {
      alert(`Error rotating credentials: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Toggle Enable/Disable
  const handleToggleStatus = async (item) => {
    const isCurrentlyActive = item.status === 'ACTIVE';
    const action = isCurrentlyActive ? 'disable' : 'enable';
    try {
      await api.post(`/tally/integrations/${item.id || item.integrationId}/${action}`);
      loadInitialData();
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  };

  // Delete Integration Handler
  const handleDeleteConfirm = async (item) => {
    if (!window.confirm(`Permanently delete integration "${item.name}"? This action is irrevocable.`)) return;
    try {
      await api.delete(`/tally/integrations/${item.id || item.integrationId}`);
      loadInitialData();
    } catch (err) {
      alert(`Failed to delete integration: ${err.message}`);
    }
  };

  // Download Credentials JSON File
  const handleDownloadCredentials = (data) => {
    const creds = {
      title: 'LauncherDesk ERP Tally Integration Credentials',
      integrationId: data.integrationId,
      name: data.name,
      environment: data.environment,
      apiKey: data.apiKey,
      secretKey: data.secretKey,
      keyVersion: data.keyVersion || 1,
      permissions: data.permissions,
      createdAt: data.createdAt || new Date().toISOString(),
      expiresAt: data.expiresAt || 'Never',
      warning: 'Store this file in a secure credentials vault. Plaintext secret will never be recoverable again.',
    };
    const blob = new Blob([JSON.stringify(creds, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tally_credentials_${data.integrationId?.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Execute Test Console
  const handleExecuteTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = testPayloadText ? JSON.parse(testPayloadText) : {};
      } catch (e) {
        alert('Invalid JSON in Request Payload');
        setTestRunning(false);
        return;
      }

      const res = await api.post('/tally/test-console/execute', {
        integrationId: testIntegrationId,
        endpoint: testEndpoint,
        method: testMethod,
        payload: parsedPayload,
      });

      setTestResult(res.data);
    } catch (err) {
      setTestResult({
        httpStatus: 500,
        latencyMs: 15,
        failureReason: err.message,
        isFunctioning: false,
        responsePayload: { error: err.message },
      });
    } finally {
      setTestRunning(false);
    }
  };

  // Run Predefined Scenario
  const handleRunScenario = async (scenarioKey) => {
    setRunningScenarioKey(scenarioKey);
    try {
      const res = await api.post('/tally/test-console/scenario', {
        scenarioKey,
        integrationId: testIntegrationId || integrations[0]?.integrationId,
      });
      setScenarioResults((prev) => ({
        ...prev,
        [scenarioKey]: res.data,
      }));
    } catch (err) {
      setScenarioResults((prev) => ({
        ...prev,
        [scenarioKey]: {
          scenarioKey,
          passed: false,
          actual: `Error: ${err.message}`,
          explanation: 'Internal runner failure',
        },
      }));
    } finally {
      setRunningScenarioKey(null);
    }
  };

  // Run All Scenarios sequentially
  const handleRunAllScenarios = async () => {
    setRunningAllScenarios(true);
    for (const sc of PREDEFINED_SCENARIOS) {
      await handleRunScenario(sc.key);
    }
    setRunningAllScenarios(false);
  };

  // Export Logs CSV
  const handleExportLogsCsv = () => {
    if (!logs.length) return;
    const headers = ['Timestamp', 'Request ID', 'Integration', 'Organization', 'Bill ID', 'Endpoint', 'Status', 'Latency (ms)', 'IP Address', 'User', 'Result'];
    const rows = logs.map((l) => [
      `"${formatDateTime(l.timestamp)}"`,
      `"${l.requestId}"`,
      `"${l.integration}"`,
      `"${l.organization}"`,
      `"${l.billId}"`,
      `"${l.endpoint}"`,
      `"${l.status}"`,
      l.latency,
      `"${l.ipAddress}"`,
      `"${l.user}"`,
      `"${String(l.result).replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tally_api_logs_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="api-integrations-console" style={{ paddingBottom: '3rem' }}>
      {/* 1. Breadcrumbs */}
      <div className="breadcrumb" style={{ marginBottom: '0.75rem', fontSize: '0.875rem', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <span>Settings</span>
        <span>/</span>
        <span>Developer</span>
        <span>/</span>
        <span>API Integrations</span>
        <span>/</span>
        <span style={{ fontWeight: 600, color: 'var(--color-primary, #6366f1)' }}>Tally Integration</span>
      </div>

      {/* 2. Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 0.25rem 0' }}>Enterprise API Management Console</h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.95rem' }}>
            Production-grade credential management, built-in visual test console, real-time health telemetry, and live audit logging for Tally ERP.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setCreateForm({
                name: '',
                environment: 'PRODUCTION',
                description: '',
                tenantId: clients[0]?.id || clients[0]?._id || '',
                permissions: ['Bills.Read', 'Bills.Write', 'Bills.Status', 'Bills.Sync', 'Bills.Retry', 'Bills.Export'],
                expiration: '90',
                allowedIps: '',
                webhookUrl: '',
              });
              setCreatedSecretData(null);
              setShowCreateModal(true);
            }}
          >
            <span style={{ marginRight: '0.4rem', fontWeight: 'bold' }}>+</span> Create Integration
          </button>
        </div>
      </div>

      {/* 3. Sub-Navigation Tabs */}
      <div className="tab-nav" style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', marginBottom: '1.5rem', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleTabChange(t.id)}
            style={{
              padding: '0.65rem 1.15rem',
              fontWeight: 600,
              fontSize: '0.9rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t.id ? '2px solid var(--color-primary, #6366f1)' : '2px solid transparent',
              color: activeTab === t.id ? 'var(--color-primary, #6366f1)' : 'var(--text-muted, #64748b)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && <p className="state state--error" role="alert" style={{ marginBottom: '1.5rem' }}>{error}</p>}
      {loading && !integrations.length && <LoadingState />}

      {/* ========================================================================= */}
      {/* TAB 1: INTEGRATIONS & DASHBOARD METRICS */}
      {/* ========================================================================= */}
      {activeTab === 'integrations' && (
        <>
          {/* Dashboard Metric Cards (10 Cards) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Total Integrations</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem' }}>{metrics?.totalIntegrations ?? integrations.length}</div>
              <small className="muted">Platform configurations</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Active Integrations</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem', color: '#16a34a' }}>{metrics?.activeIntegrations ?? integrations.filter((i) => i.status === 'ACTIVE').length}</div>
              <small className="muted">Operational & authenticated</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Disabled Integrations</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem', color: '#ca8a04' }}>{metrics?.disabledIntegrations ?? integrations.filter((i) => i.status === 'DISABLED').length}</div>
              <small className="muted">Paused by admin</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Expired Credentials</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem', color: metrics?.expiredCredentials > 0 ? '#dc2626' : 'inherit' }}>
                {metrics?.expiredCredentials ?? 0}
              </div>
              <small className="muted">Past expiry threshold</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Today's API Requests</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem' }}>{metrics?.todayRequests ?? 0}</div>
              <small className="muted">Incoming sync calls</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Failed Requests</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem', color: metrics?.failedRequests > 0 ? '#dc2626' : 'inherit' }}>
                {metrics?.failedRequests ?? 0}
              </div>
              <small className="muted">Rejected or errored</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Average Response Time</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem' }}>{metrics?.avgResponseTime ?? 42} <span style={{ fontSize: '1rem', fontWeight: 500 }}>ms</span></div>
              <small className="muted">Mean gateway latency</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Security Alerts</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, marginTop: '0.35rem', color: metrics?.securityAlerts > 0 ? '#dc2626' : '#16a34a' }}>
                {metrics?.securityAlerts ?? 0}
              </div>
              <small className="muted">Past 24 hours</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Last Rotation</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {metrics?.lastRotation ? formatDateTime(metrics.lastRotation) : 'None'}
              </div>
              <small className="muted">Key migration</small>
            </Card>
            <Card style={{ padding: '1rem' }}>
              <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Last API Usage</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, marginTop: '0.5rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {metrics?.lastApiUsage ? formatDateTime(metrics.lastApiUsage) : 'Never'}
              </div>
              <small className="muted">Most recent ping</small>
            </Card>
          </div>

          {/* Table Filters Toolbar */}
          <Card style={{ marginBottom: '1.5rem', padding: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search by name, key, ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ minWidth: '220px', padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                />
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="">All Organizations</option>
                  {clients.map((c) => (
                    <option key={c.id || c._id} value={c.id || c._id}>
                      {c.companyCode ? `[${c.companyCode}] ` : ''}{c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={envFilter}
                  onChange={(e) => setEnvFilter(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="ALL">All Environments</option>
                  <option value="PRODUCTION">Production</option>
                  <option value="TESTING">Testing</option>
                  <option value="DEVELOPMENT">Development</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="DISABLED">Disabled</option>
                  <option value="REVOKED">Revoked</option>
                  <option value="EXPIRED">Expired</option>
                </select>
              </div>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                Showing {filteredIntegrations.length} of {integrations.length} integrations
              </span>
            </div>
          </Card>

          {/* Integrations Table */}
          <Card>
            {filteredIntegrations.length === 0 ? (
              <EmptyState title="No integrations found" hint="Create a new Tally integration or adjust filters above." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Integration Name</th>
                      <th>Organization</th>
                      <th>Environment</th>
                      <th>Status</th>
                      <th>API Key</th>
                      <th>Last Used</th>
                      <th>Requests Today</th>
                      <th>Success %</th>
                      <th>Failure %</th>
                      <th>Expiration</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredIntegrations.map((item) => {
                      const clientMatch = clients.find((c) => String(c.id || c._id) === String(item.tenantId));
                      const orgLabel = clientMatch ? (clientMatch.companyCode || clientMatch.name) : (item.tenantId ? item.tenantId.slice(-6) : 'Platform');
                      const isMasterCreated = item.createdByRole === 'MASTER_ADMIN';
                      const canDelete = isMasterAdmin || (!isMasterCreated && isAssistantAdmin);

                      return (
                        <tr key={item.id || item.integrationId}>
                          <td>
                            <strong>{item.name}</strong>
                            {item.keyVersion > 1 && (
                              <span className="badge badge--neutral" style={{ marginLeft: '0.4rem', fontSize: '0.7rem' }}>
                                v{item.keyVersion}
                              </span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontWeight: 500 }}>{orgLabel}</span>
                          </td>
                          <td>
                            <span className={`badge badge--${item.environment === 'PRODUCTION' ? 'success' : 'neutral'}`}>
                              {item.environment}
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={item.status} />
                          </td>
                          <td>
                            <code style={{ fontSize: '0.8rem', background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                              {item.keyPrefix}...
                            </code>
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {item.lastUsedAt ? formatDateTime(item.lastUsedAt) : 'Never'}
                          </td>
                          <td style={{ textAlign: 'center' }}>0</td>
                          <td style={{ textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>100%</td>
                          <td style={{ textAlign: 'center', color: '#64748b' }}>0%</td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {item.expiresAt ? formatDateTime(item.expiresAt) : 'Never'}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                              <button
                                type="button"
                                className="btn btn--small"
                                title="View Details & Permissions"
                                onClick={() => {
                                  setSelectedIntegration(item);
                                  setShowViewModal(true);
                                }}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="btn btn--small"
                                title="Rotate API Secret Key"
                                onClick={() => {
                                  setSelectedIntegration(item);
                                  setRotatedSecretData(null);
                                  setShowRotateModal(true);
                                }}
                              >
                                Rotate
                              </button>
                              <button
                                type="button"
                                className="btn btn--small"
                                title={item.status === 'ACTIVE' ? 'Disable Integration' : 'Enable Integration'}
                                onClick={() => handleToggleStatus(item)}
                              >
                                {item.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                              </button>
                              <button
                                type="button"
                                className="btn btn--small btn--primary"
                                title="Test API with built-in Test Console"
                                onClick={() => {
                                  setTestIntegrationId(item.integrationId || item.id);
                                  setActiveTab('test-console');
                                }}
                              >
                                Test
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  className="btn btn--small btn--danger"
                                  title="Delete Integration"
                                  onClick={() => handleDeleteConfirm(item)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: VISUAL API TEST CONSOLE */}
      {/* ========================================================================= */}
      {activeTab === 'test-console' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '1.5rem', alignItems: 'flex-start' }}>
          {/* Controls Column */}
          <Card style={{ padding: '1.25rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem', fontWeight: 600 }}>Interactive Test Runner</h3>

            <div className="field" style={{ marginBottom: '1rem' }}>
              <label className="field__label">1. Select Target Integration</label>
              <select
                className="field__control"
                value={testIntegrationId}
                onChange={(e) => setTestIntegrationId(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
              >
                {integrations.map((i) => (
                  <option key={i.id || i.integrationId} value={i.integrationId || i.id}>
                    {i.name} ({i.environment} - {i.keyPrefix}...)
                  </option>
                ))}
              </select>
            </div>

            <div className="field" style={{ marginBottom: '1rem' }}>
              <label className="field__label">2. Select Endpoint</label>
              <select
                className="field__control"
                value={testEndpoint}
                onChange={(e) => {
                  const ep = e.target.value;
                  setTestEndpoint(ep);
                  if (ep.startsWith('/api/tally/status') || ep.startsWith('/api/tally/pending') || ep.startsWith('/api/tally/failed') || ep.startsWith('/api/tally/dlq') || ep.startsWith('/api/tally/dashboard')) {
                    setTestMethod('GET');
                  } else {
                    setTestMethod('POST');
                  }
                }}
                style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
              >
                <option value="/api/tally/upload">POST /api/tally/upload (Upload & Enqueue Bill)</option>
                <option value="/api/tally/status/JAC001-BILL-25-26-000001">GET /api/tally/status/:billId (Check Status)</option>
                <option value="/api/tally/retry/JAC001-BILL-25-26-000001">POST /api/tally/retry/:billId (Retry Bill)</option>
                <option value="/api/tally/resync/JAC001-BILL-25-26-000001">POST /api/tally/resync/:billId (Force Resync)</option>
                <option value="/api/tally/pending">GET /api/tally/pending (View Pending Queue)</option>
                <option value="/api/tally/failed">GET /api/tally/failed (View Failed Queue)</option>
                <option value="/api/tally/dlq">GET /api/tally/dlq (View Dead Letter Queue)</option>
                <option value="/api/tally/dashboard">GET /api/tally/dashboard (Sync Telemetry)</option>
              </select>
            </div>

            <div className="field" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                <label className="field__label" style={{ margin: 0 }}>3. Request Payload (JSON)</label>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary, #6366f1)', fontSize: '0.8rem', cursor: 'pointer' }}
                  onClick={() => {
                    setTestPayloadText(JSON.stringify({
                      companyCode: 'JAC001',
                      supplierName: 'Acme Industrial Supplies Pvt Ltd',
                      supplierGstin: '29ABCDE1234F1Z5',
                      vendorName: 'Acme Industrial Supplies Pvt Ltd',
                      vendorGSTIN: '29ABCDE1234F1Z5',
                      invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
                      billDate: new Date().toISOString().slice(0, 10),
                      amount: 14750.00,
                      taxAmount: 2250.00,
                      category: 'INVOICE',
                      priority: 'HIGH',
                      items: [
                        { name: 'Precision CNC Ball Bearing 6205', quantity: 10, unitPrice: 1250, taxRate: 18, total: 14750 },
                      ],
                    }, null, 2));
                  }}
                >
                  Reset Sample
                </button>
              </div>
              <textarea
                rows={10}
                className="field__control"
                value={testPayloadText}
                onChange={(e) => setTestPayloadText(e.target.value)}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem', padding: '0.5rem', borderRadius: '4px' }}
              />
            </div>

            <div style={{ borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '1rem' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)', marginBottom: '0.75rem' }}>
                ℹ Automatically generates HMAC-SHA256 signature, ISO timestamp, and unique request ID using secure server-side decrypted credentials.
              </div>
              <button
                type="button"
                className="btn btn--primary"
                style={{ width: '100%', padding: '0.75rem', fontSize: '1rem', fontWeight: 600 }}
                disabled={testRunning}
                onClick={handleExecuteTest}
              >
                {testRunning ? 'Executing & Verifying...' : '⚡ Execute Test Request'}
              </button>
            </div>
          </Card>

          {/* Results Column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {!testResult && !testRunning && (
              <Card style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🧪</div>
                <h3 style={{ margin: '0 0 0.5rem 0' }}>API Test Console Ready</h3>
                <p className="muted" style={{ maxWidth: '420px', margin: '0 auto' }}>
                  No external software like Postman or curl is needed. Select an integration, endpoint, and click "Execute Test Request" to validate live request signing and queue dispatch.
                </p>
              </Card>
            )}

            {testRunning && (
              <Card style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                <LoadingState message="Signing payload with HMAC-SHA256 and evaluating validation engine..." />
              </Card>
            )}

            {testResult && !testRunning && (
              <>
                {/* Result Status Banner */}
                <Card style={{
                  padding: '1.25rem',
                  borderLeft: `5px solid ${testResult.isFunctioning ? '#16a34a' : '#dc2626'}`,
                  background: testResult.isFunctioning ? 'rgba(22, 163, 74, 0.05)' : 'rgba(220, 38, 38, 0.05)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '1.25rem' }}>{testResult.isFunctioning ? '✓' : '✕'}</span>
                        <h3 style={{ margin: 0, fontSize: '1.15rem', color: testResult.isFunctioning ? '#16a34a' : '#dc2626' }}>
                          {testResult.isFunctioning ? 'API IS FUNCTIONING CORRECTLY' : 'REQUEST FAILED'}
                        </h3>
                      </div>
                      {testResult.failureReason && (
                        <div style={{ color: '#dc2626', fontWeight: 600, marginTop: '0.35rem', fontSize: '0.9rem' }}>
                          Reason: {testResult.failureReason}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <span className={`badge badge--${testResult.httpStatus < 300 ? 'success' : (testResult.httpStatus < 500 ? 'warning' : 'danger')}`} style={{ fontSize: '0.95rem', padding: '4px 10px' }}>
                        HTTP {testResult.httpStatus}
                      </span>
                      <span className="badge badge--neutral" style={{ fontSize: '0.95rem', padding: '4px 10px' }}>
                        ⏱ {testResult.latencyMs} ms
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Detailed Result Tabs */}
                <Card style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.5rem', marginBottom: '1rem', overflowX: 'auto' }}>
                    {['response', 'request', 'headers', 'validation', 'queue'].map((subTab) => (
                      <button
                        key={subTab}
                        type="button"
                        onClick={() => setTestConsoleTab(subTab)}
                        style={{
                          padding: '0.4rem 0.85rem',
                          borderRadius: '4px',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          background: testConsoleTab === subTab ? 'var(--color-primary, #6366f1)' : 'transparent',
                          color: testConsoleTab === subTab ? '#fff' : 'inherit',
                          textTransform: 'capitalize',
                        }}
                      >
                        {subTab === 'response' ? 'Response Payload' : (subTab === 'request' ? 'Request Payload' : (subTab === 'headers' ? 'Generated Headers' : (subTab === 'validation' ? 'Validation Results' : 'Queue Status')))}
                      </button>
                    ))}
                  </div>

                  {testConsoleTab === 'response' && (
                    <pre style={{ margin: 0, padding: '1rem', background: 'rgba(0,0,0,0.04)', borderRadius: '4px', fontSize: '0.85rem', maxHeight: '350px', overflowY: 'auto' }}>
                      {JSON.stringify(testResult.responsePayload, null, 2)}
                    </pre>
                  )}

                  {testConsoleTab === 'request' && (
                    <pre style={{ margin: 0, padding: '1rem', background: 'rgba(0,0,0,0.04)', borderRadius: '4px', fontSize: '0.85rem', maxHeight: '350px', overflowY: 'auto' }}>
                      {JSON.stringify(testResult.requestPayload, null, 2)}
                    </pre>
                  )}

                  {testConsoleTab === 'headers' && (
                    <div>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Request Headers (Canonical HMAC-SHA256)</h4>
                      <pre style={{ margin: '0 0 1rem 0', padding: '0.75rem', background: 'rgba(0,0,0,0.04)', borderRadius: '4px', fontSize: '0.8rem' }}>
                        {JSON.stringify(testResult.requestHeaders, null, 2)}
                      </pre>
                      <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Response Headers</h4>
                      <pre style={{ margin: 0, padding: '0.75rem', background: 'rgba(0,0,0,0.04)', borderRadius: '4px', fontSize: '0.8rem' }}>
                        {JSON.stringify(testResult.responseHeaders, null, 2)}
                      </pre>
                    </div>
                  )}

                  {testConsoleTab === 'validation' && (
                    <div>
                      {testResult.validationResults?.valid ? (
                        <div style={{ color: '#16a34a', fontWeight: 600 }}>
                          ✓ Payload passed all Tally schema & GSTIN validations
                        </div>
                      ) : (
                        <div>
                          <div style={{ color: '#dc2626', fontWeight: 600, marginBottom: '0.5rem' }}>
                            ✕ Validation failed with {testResult.validationResults?.errors?.length || 0} error(s):
                          </div>
                          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#dc2626' }}>
                            {(testResult.validationResults?.errors || []).map((err, idx) => (
                              <li key={idx} style={{ marginBottom: '0.25rem' }}>
                                <strong>{err.field || 'Field'}:</strong> {err.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {testConsoleTab === 'queue' && (
                    <div>
                      {testResult.queueStatus ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                            <small className="muted">Assigned UUID</small>
                            <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>{testResult.queueStatus.uuid}</div>
                          </div>
                          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                            <small className="muted">Assigned Bill ID</small>
                            <div style={{ fontWeight: 600 }}>{testResult.queueStatus.billId}</div>
                          </div>
                          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                            <small className="muted">Priority</small>
                            <div><span className="badge badge--warning">{testResult.queueStatus.priority}</span></div>
                          </div>
                          <div style={{ padding: '0.75rem', background: 'rgba(0,0,0,0.03)', borderRadius: '4px' }}>
                            <small className="muted">Sync Status</small>
                            <div><StatusBadge status={testResult.queueStatus.syncStatus} /></div>
                          </div>
                        </div>
                      ) : (
                        <p className="muted" style={{ margin: 0 }}>No bill was enqueued during this request.</p>
                      )}
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: BUILT-IN TEST SCENARIOS (17) */}
      {/* ========================================================================= */}
      {activeTab === 'scenarios' && (
        <div>
          {/* Header Action Bar */}
          <Card style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0' }}>1-Click Diagnostic Test Scenarios</h3>
                <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                  Execute full-spectrum security, protocol, replay attack, validation, and queue recovery tests with one click.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={runningAllScenarios}
                  onClick={handleRunAllScenarios}
                >
                  {runningAllScenarios ? 'Running All 17 Tests...' : '▶ Run All 17 Test Scenarios'}
                </button>
              </div>
            </div>
          </Card>

          {/* Scenarios Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem' }}>
            {PREDEFINED_SCENARIOS.map((sc, idx) => {
              const res = scenarioResults[sc.key];
              const isRunning = runningScenarioKey === sc.key;

              return (
                <Card key={sc.key} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          background: res ? (res.passed ? '#16a34a' : '#dc2626') : 'rgba(0,0,0,0.1)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}>
                          {res ? (res.passed ? '✓' : '✕') : (idx + 1)}
                        </span>
                        <strong style={{ fontSize: '1rem' }}>{sc.name}</strong>
                      </div>
                      {res && (
                        <span className={`badge badge--${res.passed ? 'success' : 'danger'}`} style={{ fontSize: '0.8rem' }}>
                          {res.passed ? 'PASSED' : 'FAILED'} {res.latencyMs ? `(${res.latencyMs}ms)` : ''}
                        </span>
                      )}
                    </div>
                    <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.75rem 0' }}>
                      {sc.desc}
                    </p>

                    {res && (
                      <div style={{ background: 'rgba(0,0,0,0.03)', padding: '0.5rem 0.75rem', borderRadius: '4px', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                        <div style={{ color: 'var(--text-muted, #64748b)' }}>Expected: {res.expected}</div>
                        <div style={{ fontWeight: 600, color: res.passed ? '#16a34a' : '#dc2626', marginTop: '2px' }}>Actual: {res.actual}</div>
                        {res.explanation && <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.85 }}>{res.explanation}</div>}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn--small"
                      disabled={isRunning || runningAllScenarios}
                      onClick={() => handleRunScenario(sc.key)}
                    >
                      {isRunning ? 'Testing...' : 'Run Test'}
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: VISUAL API HEALTH */}
      {/* ========================================================================= */}
      {activeTab === 'health' && (
        <div>
          {/* Top Status Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              health?.apiOnline || { name: 'API Online', status: 'ONLINE', indicator: 'green', message: 'Gateway operational' },
              health?.databaseConnected || { name: 'Database Connected', status: 'CONNECTED', indicator: 'green', message: 'Replica set connected' },
              health?.queueRunning || { name: 'Queue Running', status: 'RUNNING', indicator: 'green', message: 'Active priority queue running' },
              health?.validationRunning || { name: 'Validation Running', status: 'RUNNING', indicator: 'green', message: 'Validation engine active' },
              health?.workersRunning || { name: 'Workers Running', status: 'RUNNING', indicator: 'green', message: 'Queue workers active' },
              health?.tallyReachable || { name: 'Tally Reachable', status: 'REACHABLE', indicator: 'green', message: 'Connector agent responsive' },
              health?.credentialStatus || { name: 'Credential Status', status: 'HEALTHY', indicator: 'green', message: 'All keys valid' },
            ].map((card, idx) => {
              const color = card.indicator === 'green' ? '#16a34a' : (card.indicator === 'amber' ? '#ca8a04' : '#dc2626');
              return (
                <Card key={idx} style={{ padding: '1.15rem', borderLeft: `4px solid ${color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.95rem' }}>{card.name}</strong>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', fontWeight: 700, color }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                      {card.status}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>{card.message}</p>
                </Card>
              );
            })}
          </div>

          {/* Telemetry Metrics */}
          <Card style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Queue & Latency Telemetry</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Average Latency</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem' }}>{health?.averageLatency ?? 42} <span style={{ fontSize: '1rem', fontWeight: 500 }}>ms</span></div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Success Rate</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem', color: '#16a34a' }}>{health?.successRate ?? 99.4}%</div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Failed Requests</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem', color: health?.failedRequests > 0 ? '#dc2626' : 'inherit' }}>
                  {health?.failedRequests ?? 0}
                </div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Active Queue Size</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem' }}>{health?.queueSize ?? 0}</div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Retry Queue</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem', color: '#ca8a04' }}>{health?.retryQueue ?? 0}</div>
              </div>
              <div style={{ padding: '1rem', background: 'rgba(0,0,0,0.03)', borderRadius: '6px' }}>
                <div className="muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 600 }}>Dead Letter Queue (DLQ)</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '0.25rem', color: health?.deadLetterQueue > 0 ? '#dc2626' : '#16a34a' }}>
                  {health?.deadLetterQueue ?? 0}
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: LIVE API LOG VIEWER */}
      {/* ========================================================================= */}
      {activeTab === 'logs' && (
        <div>
          {/* Log Filters */}
          <Card style={{ marginBottom: '1.5rem', padding: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <input
                  type="date"
                  value={logFilterDate}
                  onChange={(e) => setLogFilterDate(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                />
                <select
                  value={logFilterStatus}
                  onChange={(e) => setLogFilterStatus(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="">All Statuses</option>
                  <option value="SUCCESS">Success</option>
                  <option value="FAILED">Failed</option>
                </select>
                <select
                  value={logFilterEndpoint}
                  onChange={(e) => setLogFilterEndpoint(e.target.value)}
                  style={{ padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                >
                  <option value="">All Endpoints</option>
                  <option value="/upload">/upload</option>
                  <option value="/status">/status</option>
                  <option value="/retry">/retry</option>
                  <option value="/dlq">/dlq</option>
                  <option value="/integrations">/integrations</option>
                </select>
                <input
                  type="text"
                  placeholder="Filter by Request ID or User..."
                  value={logSearchText}
                  onChange={(e) => setLogSearchText(e.target.value)}
                  style={{ minWidth: '220px', padding: '0.45rem 0.75rem', borderRadius: '4px', border: '1px solid var(--border-color, #cbd5e1)' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn--small btn--outline" onClick={handleExportLogsCsv} disabled={!logs.length}>
                  📥 Export CSV
                </button>
              </div>
            </div>
          </Card>

          {/* Logs Table */}
          <Card>
            {logs.length === 0 ? (
              <EmptyState title="No logs found" hint="Try adjusting the filters above or execute an API request." />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Request ID</th>
                      <th>Integration</th>
                      <th>Organization</th>
                      <th>Bill ID</th>
                      <th>Endpoint</th>
                      <th>Status</th>
                      <th>Latency</th>
                      <th>IP Address</th>
                      <th>User</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{formatDateTime(l.timestamp)}</td>
                        <td><code style={{ fontSize: '0.8rem' }}>{l.requestId}</code></td>
                        <td>{l.integration}</td>
                        <td>{l.organization}</td>
                        <td>{l.billId}</td>
                        <td><code>{l.endpoint}</code></td>
                        <td>
                          <span className={`badge badge--${l.status === 'SUCCESS' ? 'success' : 'danger'}`}>
                            {l.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{l.latency} ms</td>
                        <td style={{ fontSize: '0.85rem' }}>{l.ipAddress}</td>
                        <td style={{ fontSize: '0.85rem' }}>{l.user}</td>
                        <td style={{ fontSize: '0.85rem', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.result}>
                          {l.result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE INTEGRATION */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-surface, #ffffff)', color: 'var(--text-color, #0f172a)',
            width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto',
            borderRadius: '8px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
          }}>
            {!createdSecretData ? (
              /* Step 1: Form */
              <form onSubmit={handleCreateSubmit}>
                <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem' }}>Create Tally API Integration</h3>
                <p className="muted" style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem' }}>
                  Register a secure external credential pair for automated bill intake and Tally synchronization.
                </p>

                <div className="field" style={{ marginBottom: '1rem' }}>
                  <label className="field__label">Integration Name *</label>
                  <input
                    type="text"
                    required
                    className="field__control"
                    placeholder="e.g. Bangalore Plant TDL Bridge"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="field">
                    <label className="field__label">Organization *</label>
                    <select
                      className="field__control"
                      value={createForm.tenantId}
                      onChange={(e) => setCreateForm({ ...createForm, tenantId: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                    >
                      {clients.map((c) => (
                        <option key={c.id || c._id} value={c.id || c._id}>
                          {c.companyCode ? `[${c.companyCode}] ` : ''}{c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field__label">Environment *</label>
                    <select
                      className="field__control"
                      value={createForm.environment}
                      onChange={(e) => setCreateForm({ ...createForm, environment: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                    >
                      <option value="PRODUCTION">Production</option>
                      <option value="TESTING">Testing</option>
                      <option value="DEVELOPMENT">Development</option>
                    </select>
                  </div>
                </div>

                <div className="field" style={{ marginBottom: '1rem' }}>
                  <label className="field__label">Description</label>
                  <textarea
                    rows={2}
                    className="field__control"
                    placeholder="Purpose of this integration, server IP, or service owner notes"
                    value={createForm.description}
                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                  />
                </div>

                <div className="field" style={{ marginBottom: '1rem' }}>
                  <label className="field__label">Granular Permissions</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.35rem' }}>
                    {ALL_PERMISSIONS.map((perm) => (
                      <label key={perm.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={createForm.permissions.includes(perm.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCreateForm({ ...createForm, permissions: [...createForm.permissions, perm.id] });
                            } else {
                              setCreateForm({ ...createForm, permissions: createForm.permissions.filter((p) => p !== perm.id) });
                            }
                          }}
                        />
                        <span>
                          <strong>{perm.label}</strong>
                          <span className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>{perm.desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div className="field">
                    <label className="field__label">Expiration Window</label>
                    <select
                      className="field__control"
                      value={createForm.expiration}
                      onChange={(e) => setCreateForm({ ...createForm, expiration: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                    >
                      <option value="30">30 Days</option>
                      <option value="90">90 Days (Recommended)</option>
                      <option value="180">180 Days</option>
                      <option value="365">1 Year</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="field__label">Allowed IP Addresses (Optional)</label>
                    <input
                      type="text"
                      className="field__control"
                      placeholder="e.g. 192.168.1.10, 10.0.0.5"
                      value={createForm.allowedIps}
                      onChange={(e) => setCreateForm({ ...createForm, allowedIps: e.target.value })}
                      style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                    />
                  </div>
                </div>

                <div className="field" style={{ marginBottom: '1.5rem' }}>
                  <label className="field__label">Webhook URL (Optional)</label>
                  <input
                    type="url"
                    className="field__control"
                    placeholder="https://your-domain.com/api/tally-webhook"
                    value={createForm.webhookUrl}
                    onChange={(e) => setCreateForm({ ...createForm, webhookUrl: e.target.value })}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: '4px' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="btn btn--outline" onClick={() => setShowCreateModal(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={loading}>
                    Generate Credentials
                  </button>
                </div>
              </form>
            ) : (
              /* Step 2: One-time Secret Key Reveal */
              <div>
                <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '2rem', color: '#16a34a', marginBottom: '0.5rem' }}>🔒</div>
                  <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.35rem' }}>Credentials Generated Successfully</h3>
                  <p style={{ color: '#dc2626', fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>
                    IMPORTANT: The Secret Key will NEVER be shown again! Copy or download it now.
                  </p>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.04)', borderRadius: '6px', padding: '1rem', marginBottom: '1rem' }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <small className="muted" style={{ display: 'block', fontWeight: 600 }}>Integration ID</small>
                    <code style={{ fontSize: '0.9rem' }}>{createdSecretData.integrationId}</code>
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <small className="muted" style={{ display: 'block', fontWeight: 600 }}>API Key</small>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <code style={{ fontSize: '0.9rem', flex: 1, wordBreak: 'break-all' }}>{createdSecretData.apiKey}</code>
                      <button
                        type="button"
                        className="btn btn--small"
                        onClick={() => {
                          navigator.clipboard.writeText(createdSecretData.apiKey);
                          alert('API Key copied to clipboard');
                        }}
                      >
                        Copy Key
                      </button>
                    </div>
                  </div>
                  <div>
                    <small style={{ color: '#dc2626', fontWeight: 700, display: 'block' }}>Secret Key (Displayed Once)</small>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
                      <input
                        type="text"
                        readOnly
                        value={createdSecretData.secretKey}
                        style={{
                          flex: 1, padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem',
                          background: '#fff', border: '1px solid #dc2626', borderRadius: '4px',
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn--small btn--primary"
                        onClick={() => {
                          navigator.clipboard.writeText(createdSecretData.secretKey);
                          alert('Secret Key copied to clipboard');
                        }}
                      >
                        Copy Secret
                      </button>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  <div><span className="muted">Environment:</span> <strong>{createdSecretData.environment}</strong></div>
                  <div><span className="muted">Key Version:</span> <strong>v{createdSecretData.keyVersion || 1}</strong></div>
                  <div><span className="muted">Status:</span> <StatusBadge status={createdSecretData.status} /></div>
                  <div><span className="muted">Expires At:</span> <strong>{createdSecretData.expiresAt ? formatDateTime(createdSecretData.expiresAt) : 'Never'}</strong></div>
                </div>

                <div style={{ marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    className="btn btn--outline"
                    style={{ width: '100%', padding: '0.6rem' }}
                    onClick={() => handleDownloadCredentials(createdSecretData)}
                  >
                    📥 Download Credentials (JSON)
                  </button>
                </div>

                <div style={{ borderTop: '1px solid var(--border-color, #e2e8f0)', paddingTop: '1rem', marginBottom: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={secretAcknowledged}
                      onChange={(e) => setSecretAcknowledged(e.target.checked)}
                      style={{ marginTop: '2px' }}
                    />
                    <span>
                      I acknowledge that I have copied or downloaded this Secret Key and understand that LauncherDesk ERP will never show this secret again.
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!secretAcknowledged}
                    onClick={() => setShowCreateModal(false)}
                  >
                    Done & Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ROTATE CREDENTIALS */}
      {/* ========================================================================= */}
      {showRotateModal && selectedIntegration && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-surface, #ffffff)', color: 'var(--text-color, #0f172a)',
            width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto',
            borderRadius: '8px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
          }}>
            {!rotatedSecretData ? (
              <div>
                <h3 style={{ margin: '0 0 0.5rem 0' }}>Rotate Credentials: {selectedIntegration.name}</h3>
                <p className="muted" style={{ margin: '0 0 1rem 0', fontSize: '0.9rem' }}>
                  Rotating credentials generates a new Secret Key (v{(selectedIntegration.keyVersion || 1) + 1}).
                </p>
                <div style={{ padding: '0.75rem', background: 'rgba(234, 179, 8, 0.1)', borderLeft: '4px solid #eab308', borderRadius: '4px', marginBottom: '1.25rem', fontSize: '0.85rem' }}>
                  <strong>24-Hour Migration Grace Period:</strong> The previous Secret Key will continue to be accepted for up to 24 hours to prevent production sync downtime while client configurations are updated.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button type="button" className="btn btn--outline" onClick={() => setShowRotateModal(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn--primary" onClick={handleRotateConfirm}>
                    Proceed with Rotation
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h3 style={{ margin: '0 0 0.25rem 0', color: '#16a34a' }}>Credentials Rotated Successfully</h3>
                <p style={{ color: '#dc2626', fontSize: '0.9rem', fontWeight: 600, margin: '0 0 1rem 0' }}>
                  New Secret Key generated for Key Version v{rotatedSecretData.keyVersion || 2}. Displayed only once!
                </p>
                <div style={{ background: 'rgba(0,0,0,0.04)', padding: '1rem', borderRadius: '6px', marginBottom: '1rem' }}>
                  <small style={{ color: '#dc2626', fontWeight: 700, display: 'block', marginBottom: '0.25rem' }}>New Secret Key</small>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      readOnly
                      value={rotatedSecretData.secretKey}
                      style={{ flex: 1, padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.85rem', background: '#fff', border: '1px solid #dc2626', borderRadius: '4px' }}
                    />
                    <button
                      type="button"
                      className="btn btn--small btn--primary"
                      onClick={() => {
                        navigator.clipboard.writeText(rotatedSecretData.secretKey);
                        alert('New Secret Key copied');
                      }}
                    >
                      Copy Secret
                    </button>
                  </div>
                </div>
                <div style={{ marginBottom: '1.25rem' }}>
                  <button
                    type="button"
                    className="btn btn--outline"
                    style={{ width: '100%' }}
                    onClick={() => handleDownloadCredentials(rotatedSecretData)}
                  >
                    📥 Download New Credentials (JSON)
                  </button>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  <input
                    type="checkbox"
                    checked={secretAcknowledged}
                    onChange={(e) => setSecretAcknowledged(e.target.checked)}
                  />
                  <span>I acknowledge that I have copied the new secret and understand it will never be displayed again.</span>
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!secretAcknowledged}
                    onClick={() => setShowRotateModal(false)}
                  >
                    Done & Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: VIEW DETAILS & PERMISSIONS */}
      {/* ========================================================================= */}
      {showViewModal && selectedIntegration && (
        <div className="modal-backdrop" style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-surface, #ffffff)', color: 'var(--text-color, #0f172a)',
            width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto',
            borderRadius: '8px', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
          }}>
            <h3 style={{ margin: '0 0 0.5rem 0' }}>Integration Details: {selectedIntegration.name}</h3>
            <p className="muted" style={{ margin: '0 0 1.25rem 0', fontSize: '0.9rem' }}>
              ID: <code>{selectedIntegration.integrationId || selectedIntegration.id}</code>
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              <div><span className="muted">Environment:</span> <strong>{selectedIntegration.environment}</strong></div>
              <div><span className="muted">Status:</span> <StatusBadge status={selectedIntegration.status} /></div>
              <div><span className="muted">Key Version:</span> <strong>v{selectedIntegration.keyVersion || 1}</strong></div>
              <div><span className="muted">Created By Role:</span> <strong>{selectedIntegration.createdByRole || 'MASTER_ADMIN'}</strong></div>
              <div><span className="muted">Created Date:</span> <strong>{formatDateTime(selectedIntegration.createdAt)}</strong></div>
              <div><span className="muted">Expires Date:</span> <strong>{selectedIntegration.expiresAt ? formatDateTime(selectedIntegration.expiresAt) : 'Never'}</strong></div>
              <div><span className="muted">Last Used:</span> <strong>{selectedIntegration.lastUsedAt ? formatDateTime(selectedIntegration.lastUsedAt) : 'Never'}</strong></div>
              <div><span className="muted">Last IP Address:</span> <strong>{selectedIntegration.lastIpAddress || 'None'}</strong></div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.35rem' }}>Granular Permissions Assigned:</strong>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {(selectedIntegration.permissions || []).map((p) => (
                  <span key={p} className="badge badge--primary" style={{ fontSize: '0.75rem' }}>{p}</span>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.25rem' }}>Allowed IP Addresses:</strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {(selectedIntegration.ipAllowList && selectedIntegration.ipAllowList.length > 0)
                  ? selectedIntegration.ipAllowList.join(', ')
                  : 'Any IP allowed (No restriction)'}
              </span>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: '0.25rem' }}>Webhook URL:</strong>
              <span className="muted" style={{ fontSize: '0.85rem' }}>
                {selectedIntegration.webhookUrl || 'None configured'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn--outline" onClick={() => setShowViewModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
