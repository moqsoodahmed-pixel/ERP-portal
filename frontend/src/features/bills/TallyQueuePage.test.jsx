import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { api } from '../../services/apiClient.js';
import TallyQueuePage from './TallyQueuePage.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const withAuth = (ui, user) => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter>{ui}</MemoryRouter>
  </AuthContext.Provider>,
);

const manager = { name: 'Admin', role: 'MASTER_ADMIN', permissions: ['tally_queue.view', 'bills.tally_manage'] };
const viewerOnly = { name: 'Vendor', role: 'GST_VENDOR', permissions: ['tally_queue.view'] };

const page1 = {
  items: [
    { id: 'b1', billNumber: 'B-1', amount: '100.00', status: 'ACCOUNTING_IN_PROGRESS', tallyStatus: 'FAILED', readyAt: '2026-01-01T00:00:00Z', lastSyncAttemptAt: '2026-01-02T00:00:00Z', failureReason: 'TALLY_UNREACHABLE', retryAvailable: true },
  ],
  pagination: { page: 1, limit: 20, total: 25, totalPages: 2 },
};

describe('Phase 16.1 Tally job queue (bill queue) UI', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading, then the queue rows with pagination info', async () => {
    api.get.mockResolvedValue({ data: page1 });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByText('B-1')).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it('shows an empty state when the queue has no items', async () => {
    api.get.mockResolvedValue({ data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    expect(await screen.findByText('Queue is empty')).toBeInTheDocument();
  });

  it('shows an error state on fetch failure', async () => {
    api.get.mockRejectedValue({ status: 500, message: 'Boom' });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('filtering by Tally status re-queries the real backend endpoint with tallyStatus', async () => {
    api.get.mockResolvedValue({ data: page1 });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    await screen.findByText('B-1');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'FAILED');
    await waitFor(() => expect(api.get.mock.calls.some(([p]) => p.includes('tallyStatus=FAILED'))).toBe(true));
  });

  it('paginates using the next/previous controls against the real page param', async () => {
    api.get.mockResolvedValue({ data: page1 });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    await screen.findByText('B-1');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.get.mock.calls.some(([p]) => p.includes('page=2'))).toBe(true));
  });

  it('hides the retry action for a user without bills.tally_manage', async () => {
    api.get.mockResolvedValue({ data: page1 });
    withAuth(<TallyQueuePage detailBasePath="/vendor/bills" />, viewerOnly);
    await screen.findByText('B-1');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('retry requires confirmation and then calls the real manual retry endpoint (never a client-side mutation)', async () => {
    api.get.mockResolvedValue({ data: page1 });
    api.post.mockResolvedValue({ data: {} });
    withAuth(<TallyQueuePage detailBasePath="/master/bills" />, manager);
    await screen.findByText('B-1');

    await userEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    const dialogRetryButton = screen.getAllByRole('button', { name: 'Retry' })[1];
    await userEvent.click(dialogRetryButton);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/bills/b1/tally/retry'));
  });
});
