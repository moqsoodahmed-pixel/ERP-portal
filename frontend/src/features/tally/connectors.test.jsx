import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { api } from '../../services/apiClient.js';
import ConnectorListPage from './ConnectorListPage.jsx';
import ConnectorDetailPage from './ConnectorDetailPage.jsx';
import { deriveConnectorDisplayStatus } from './connectorsApi.js';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const withAuth = (ui, user, path = '/master/tally-connectors') => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/master/tally-connectors" element={ui} />
        <Route path="/master/tally-connectors/:id" element={<ConnectorDetailPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

const manager = { name: 'Admin', role: 'MASTER_ADMIN', permissions: ['tally.connector.view', 'tally.connector.manage'] };
const viewer = { name: 'Viewer', role: 'MASTER_ADMIN', permissions: ['tally.connector.view'] };

describe('Phase 16.1 connector display status derivation', () => {
  it('maps REVOKED/INACTIVE/ACTIVE+heartbeat/ACTIVE+never to the correct label without inventing backend statuses', () => {
    expect(deriveConnectorDisplayStatus({ status: 'REVOKED' })).toMatchObject({ label: 'Revoked' });
    expect(deriveConnectorDisplayStatus({ status: 'INACTIVE' })).toMatchObject({ label: 'Offline' });
    expect(deriveConnectorDisplayStatus({ status: 'ACTIVE', lastHeartbeatAt: null })).toMatchObject({ label: 'Never connected' });
    expect(deriveConnectorDisplayStatus({ status: 'ACTIVE', lastHeartbeatAt: '2026-01-01T00:00:00Z' })).toMatchObject({ label: 'Online' });
  });
});

describe('ConnectorListPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading state then the connector list', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1', name: 'Shop PC', status: 'ACTIVE', lastHeartbeatAt: null, version: '1.0.0', tallyCompanyName: null, createdAt: '2026-01-01', updatedAt: '2026-01-01' }] });
    withAuth(<ConnectorListPage />, viewer);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('Shop PC')).toBeInTheDocument();
    expect(screen.getByText('Never connected')).toBeInTheDocument();
  });

  it('shows an empty state when there are no connectors', async () => {
    api.get.mockResolvedValue({ data: [] });
    withAuth(<ConnectorListPage />, viewer);
    expect(await screen.findByText('No connectors registered')).toBeInTheDocument();
  });

  it('shows an error state on fetch failure', async () => {
    api.get.mockRejectedValue({ status: 500, message: 'Boom' });
    withAuth(<ConnectorListPage />, viewer);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('hides register/rotate/revoke actions for a user without tally.connector.manage', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1', name: 'Shop PC', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] });
    withAuth(<ConnectorListPage />, viewer);
    await screen.findByText('Shop PC');
    expect(screen.queryByText('Register a new connector')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('registration reveals the raw secret exactly once and it is gone after dismissal (never restorable, never persisted)', async () => {
    api.get.mockResolvedValue({ data: [] });
    api.post.mockResolvedValue({ data: { id: 'c2', name: 'New PC', status: 'ACTIVE', connectorSecret: 'tcs_live_raw_secret_value' } });
    withAuth(<ConnectorListPage />, manager);
    await screen.findByText('No connectors registered');

    await userEvent.type(screen.getByLabelText('Name *'), 'New PC');
    await userEvent.click(screen.getByRole('button', { name: 'Register connector' }));

    expect(await screen.findByText('tcs_live_raw_secret_value')).toBeInTheDocument();
    expect(screen.getByText(/cannot be retrieved again/)).toBeInTheDocument();
    expect(localStorage.getItem('tcs_live_raw_secret_value')).toBeNull();
    expect(window.location.href).not.toContain('tcs_live_raw_secret_value');

    await userEvent.click(screen.getByRole('button', { name: /I.ve stored it securely/ }));
    expect(screen.queryByText('tcs_live_raw_secret_value')).toBeNull();
  });

  it('revoke requires confirmation before calling the backend', async () => {
    api.get.mockResolvedValue({ data: [{ id: 'c1', name: 'Shop PC', status: 'ACTIVE', createdAt: '2026-01-01', updatedAt: '2026-01-01' }] });
    api.post.mockResolvedValue({ data: {} });
    withAuth(<ConnectorListPage />, manager);
    await screen.findByText('Shop PC');

    await userEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    const dialogRevokeButton = screen.getAllByRole('button', { name: 'Revoke' })[1];
    await userEvent.click(dialogRevokeButton);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tally/connectors/c1/revoke'));
  });
});

describe('ConnectorDetailPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders detail fields including last error and never displays a secret hash/value from the GET response', async () => {
    api.get.mockResolvedValue({
      data: {
        id: 'c1', name: 'Shop PC', status: 'ACTIVE', secretPrefix: 'tcs_abc', scopes: ['tally:connector:poll'],
        version: '1.2.0', lastHeartbeatAt: '2026-01-01T00:00:00Z', lastPollAt: null, lastSuccessfulSyncAt: null,
        lastTallyAvailable: null, lastErrorCode: 'TALLY_UNREACHABLE', lastErrorMessage: 'connection refused',
        tallyCompanyName: 'Acme', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      },
    });
    withAuth(<ConnectorListPage />, manager, '/master/tally-connectors/c1');
    expect(await screen.findByText('TALLY_UNREACHABLE — connection refused')).toBeInTheDocument();
    expect(screen.getByText(/tcs_abc/)).toBeInTheDocument();
    expect(screen.queryByText(/secretHash/i)).toBeNull();
  });
});
