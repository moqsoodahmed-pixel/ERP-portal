import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import GstBillingDashboardPage from './GstBillingDashboardPage.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn(), getBlob: vi.fn() },
}));

const renderPage = () => render(
  <MemoryRouter initialEntries={['/client/gst-filings/f1/billing']}>
    <Routes>
      <Route path="/client/gst-filings/:id/billing" element={<GstBillingDashboardPage />} />
    </Routes>
  </MemoryRouter>,
);

const profile = { displayName: 'ABC Technologies Pvt Ltd', gstin: '29AAAAA0000A1Z5' };
const filing = { periodLabel: 'October 2026', periodKey: '2026-10', returnType: 'GSTR_1' };

function mockGetByPath({ finalDocuments = [], match = null, filingOverride = filing, profileOverride = profile }) {
  api.get.mockImplementation((path) => {
    if (path === '/business-profile') return Promise.resolve({ data: profileOverride });
    if (path.endsWith('/final-documents')) return Promise.resolve({ data: { items: finalDocuments } });
    if (path.endsWith('/tally-matching')) return match ? Promise.resolve({ data: match }) : Promise.reject({ status: 404 });
    if (path === '/gst-filings/f1') return Promise.resolve({ data: filingOverride });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('Phase 21 Client GST Billing Dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the dashboard with company, GSTIN, and filing information', async () => {
    mockGetByPath({});
    renderPage();
    expect(await screen.findByText('GST Billing')).toBeInTheDocument();
    expect(screen.getByText('ABC Technologies Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText('29AAAAA0000A1Z5')).toBeInTheDocument();
    expect(screen.getByText(/October 2026/)).toBeInTheDocument();
  });

  it('shows "Awaiting Vendor Processing" when no matching has run yet', async () => {
    mockGetByPath({ match: null });
    renderPage();
    expect(await screen.findByText('Awaiting Vendor Processing')).toBeInTheDocument();
  });

  it('shows "Vendor Processing Completed" only when matching is FULLY_MATCHED', async () => {
    mockGetByPath({ match: { overallStatus: 'FULLY_MATCHED' } });
    renderPage();
    expect(await screen.findByText('Vendor Processing Completed')).toBeInTheDocument();
  });

  it('shows "Vendor Processing In Progress" for a PARTIAL_MATCH, never "Completed"', async () => {
    mockGetByPath({ match: { overallStatus: 'PARTIAL_MATCH' } });
    renderPage();
    expect(await screen.findByText('Vendor Processing In Progress')).toBeInTheDocument();
    expect(screen.queryByText('Vendor Processing Completed')).toBeNull();
  });

  it('shows the empty state with no vendor document, never fake example data', async () => {
    mockGetByPath({ finalDocuments: [] });
    renderPage();
    expect(await screen.findByText(/No final document available yet\./)).toBeInTheDocument();
  });

  it('renders final document metadata: file name, uploader, upload date, View and Download actions', async () => {
    mockGetByPath({ finalDocuments: [{ id: 'd1', fileName: 'GST Final Bill.pdf', uploadedAt: '2026-10-08T00:00:00Z' }] });
    renderPage();
    expect(await screen.findByText('GST Final Bill.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by GST Vendor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Document' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('clicking View Document retrieves it through the authenticated endpoint', async () => {
    mockGetByPath({ finalDocuments: [{ id: 'd1', fileName: 'final.pdf', uploadedAt: '2026-10-08T00:00:00Z' }] });
    api.getBlob.mockResolvedValue({ blob: new Blob(['x']) });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
    window.open = vi.fn();
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View Document' }));
    expect(api.getBlob).toHaveBeenCalledWith('/gst-filings/f1/final-documents/d1');
  });

  it('shows a loading state while fetching', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error state on fetch failure, not a stack trace', async () => {
    api.get.mockRejectedValue({ status: 500, message: 'Boom' });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });
});
