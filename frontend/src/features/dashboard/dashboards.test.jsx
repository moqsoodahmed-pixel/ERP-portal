import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { ClientDashboard, VendorDashboard } from './dashboards.jsx';
import { api } from '../../services/apiClient.js';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn() },
  toQuery: (p) => { const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString(); return s ? `?${s}` : ''; },
}));

const withAuth = (ui, user) => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}><MemoryRouter>{ui}</MemoryRouter></AuthContext.Provider>,
);

describe('Phase 9 dashboards', () => {
  it('client dashboard renders server-computed totals and shows payments as not available (never zero)', async () => {
    api.get.mockResolvedValue({
      data: {
        range: { preset: 'this_month', from: '2026-04-01T00:00:00Z', to: '2026-04-30T23:59:59Z' },
        invoices: {
          available: true, byStatus: { DRAFT: 1, ISSUED: 3, CANCELLED: 1 },
          issued: { count: 3, taxableAmount: '900.00', totalGst: '90.00', grandTotal: '990.00' },
          payments: { available: false, reason: 'no payment-recording workflow is implemented', paidAmount: null, outstandingAmount: null },
        },
        customers: { available: true, active: 4 }, products: { available: true, active: 2 },
        tally: { available: false, reason: 'PERMISSION_REQUIRED', permission: 'tally.view' },
        gstFilings: { available: false, reason: 'PERMISSION_REQUIRED' },
      },
    });
    withAuth(<ClientDashboard />, { name: 'Asha', role: 'CLIENT_USER', permissions: ['invoices.view'] });
    expect(await screen.findByText('₹990.00')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/dashboard?range=this_month');
    expect(screen.getByText(/Payments received \/ outstanding: not available/)).toBeInTheDocument();
    expect(screen.queryByText(/Tally synced/)).toBeNull();
    expect(screen.getByText('Welcome, Asha')).toBeInTheDocument();
  });

  it('vendor dashboard uses the server-side endpoint (no client-side counting of filings)', async () => {
    api.get.mockResolvedValue({
      data: {
        assignedClients: 2,
        gstFilings: { pipeline: { NOT_STARTED: 0, IN_PROGRESS: 2, READY_FOR_REVIEW: 1, SUBMITTED: 0, FILED: 4 }, total: 7, inProgress: 3, openIssues: 5 },
        bills: { byStatus: { DRAFT: 0, SUBMITTED: 1, UNDER_REVIEW: 0, READY_FOR_TALLY: 2, ACCOUNTING_IN_PROGRESS: 1, COMPLETED: 3, REJECTED: 0, FAILED: 0 }, pendingReview: 1, note: 'Internal ERP bill-intake workflow status (Phase 15), not a Tally or government confirmation.' },
        tallyJobs: { byStatus: { QUEUED: 1, CLAIMED: 0, PROCESSING: 0, SUCCEEDED: 3, FAILED: 1 }, retryable: 1, note: 'Tally job queue status only.' },
        clients: [{ tenantId: 't1', businessName: 'Client One', pipeline: { NOT_STARTED: 0, IN_PROGRESS: 2, READY_FOR_REVIEW: 1, SUBMITTED: 0, FILED: 4 }, openIssues: 5 }],
      },
    });
    withAuth(<VendorDashboard />, { name: 'V', role: 'GST_VENDOR', permissions: ['dashboard.view'] });
    expect(await screen.findByRole('link', { name: 'Client One' })).toHaveAttribute('href', '/vendor/clients/t1');
    expect(api.get).toHaveBeenCalledWith('/vendors/me/dashboard');
    expect(screen.getByText('GST filings in progress').previousSibling).toHaveTextContent('3');
    expect(screen.getByText('Awaiting ERP review').previousSibling).toHaveTextContent('1');
    expect(screen.getByText('Failed (retryable)').previousSibling).toHaveTextContent('1');
  });
});
