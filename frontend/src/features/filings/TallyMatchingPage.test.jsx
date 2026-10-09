import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { api } from '../../services/apiClient.js';
import TallyMatchingPage from './TallyMatchingPage.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: {
    get: vi.fn(), post: vi.fn(), getBlob: vi.fn(),
  },
}));

const withAuth = (user) => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter initialEntries={['/vendor/gst-filings/f1/tally-matching']}>
      <Routes>
        <Route path="/vendor/gst-filings/:id/tally-matching" element={<TallyMatchingPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

const vendor = { name: 'Vendor', role: 'GST_VENDOR', permissions: ['gst_bills.view', 'gst_bills.match', 'gst_bills.final_document.upload'] };
const clientAdmin = { name: 'Client', role: 'CLIENT_ADMIN', permissions: ['gst_bills.view'] };

const fullyMatched = {
  _id: 'm1', totalClientBills: 10, totalTallyBills: 10, matchedCount: 10, unmatchedCount: 0, extraTallyCount: 0,
  overallStatus: 'FULLY_MATCHED',
  results: Array.from({ length: 10 }, (_, i) => ({
    serialNo: i + 1, productName: `Product ${i + 1}`, rate: '100.00', tallyVoucherNumber: `T-${i + 1}`, status: 'MATCHED', reason: 'Bill matched successfully.',
  })),
};

const partialMatched = {
  _id: 'm2', totalClientBills: 10, totalTallyBills: 10, matchedCount: 9, unmatchedCount: 1, extraTallyCount: 0,
  overallStatus: 'PARTIAL_MATCH',
  results: [
    { serialNo: 1, productName: 'OK Item', rate: '10.00', tallyVoucherNumber: 'T-1', status: 'MATCHED', reason: 'Bill matched successfully.' },
    { serialNo: 2, productName: 'Bad Item', rate: '20.00', tallyVoucherNumber: null, status: 'NOT_FOUND', reason: 'No corresponding Tally bill found.' },
  ],
};

/** Routes api.get by path so the matching-result call and the final-documents call can return independent data. */
function mockGetByPath({ matching, matchingError, finalDocs = [] }) {
  api.get.mockImplementation((path) => {
    if (path.includes('final-documents')) return Promise.resolve({ data: { items: finalDocs } });
    if (matchingError) return Promise.reject(matchingError);
    return Promise.resolve({ data: matching });
  });
}

describe('Phase 20 GST Bill Matching page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders client/Tally/matched/unmatched counts and the overall status', async () => {
    mockGetByPath({ matching: fullyMatched });
    withAuth(vendor);
    expect(await screen.findByText('GST Bill Matching')).toBeInTheDocument();
    expect(screen.getAllByText('10')[0]).toBeInTheDocument();
    expect(screen.getByText(/Bills Matched/)).toBeInTheDocument();
  });

  it('renders per-bill results including MATCHED status', async () => {
    mockGetByPath({ matching: fullyMatched });
    withAuth(vendor);
    expect(await screen.findByText(/Bill 1 — Product 1/)).toBeInTheDocument();
    expect(screen.getAllByText('Matched').length).toBeGreaterThan(0);
  });

  it('a 10/10 full match is displayed as FULLY_MATCHED, not partial', async () => {
    mockGetByPath({ matching: fullyMatched });
    withAuth(vendor);
    await screen.findByText('GST Bill Matching');
    expect(screen.getByText('Fully matched')).toBeInTheDocument();
    expect(screen.queryByText('Partial match')).toBeNull();
  });

  it('a 9/10 match is NEVER displayed as fully matched', async () => {
    mockGetByPath({ matching: partialMatched });
    withAuth(vendor);
    await screen.findByText('GST Bill Matching');
    expect(screen.getByText('Partial match')).toBeInTheDocument();
    expect(screen.queryByText('Fully matched')).toBeNull();
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('shows the empty state with a Run Tally Match action for an authorized vendor', async () => {
    mockGetByPath({ matchingError: { status: 404 } });
    withAuth(vendor);
    expect(await screen.findByText('Tally matching has not been run for this filing yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run Tally Match' })).toBeInTheDocument();
  });

  it('a CLIENT_ADMIN (view-only) sees the empty state without a Run action', async () => {
    mockGetByPath({ matchingError: { status: 404 } });
    withAuth(clientAdmin);
    expect(await screen.findByText('Tally matching has not been run for this filing yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run Tally Match' })).toBeNull();
  });

  it('shows a TALLY_ERROR state with a retry action, never a stack trace', async () => {
    mockGetByPath({ matching: { overallStatus: 'TALLY_ERROR', errorMessage: 'Unable to retrieve Tally data. Please check the Tally connection and try again.' } });
    withAuth(vendor);
    expect(await screen.findByText('TALLY CONNECTION ERROR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('clicking Run Tally Match calls the real run endpoint and renders the returned result', async () => {
    mockGetByPath({ matchingError: { status: 404 } });
    api.post.mockResolvedValue({ data: fullyMatched });
    withAuth(vendor);
    await userEvent.click(await screen.findByRole('button', { name: 'Run Tally Match' }));
    expect(api.post).toHaveBeenCalledWith('/gst-filings/f1/tally-matching/run');
    expect(await screen.findByText('Fully matched')).toBeInTheDocument();
  });

  it('retry after a failure re-invokes the run endpoint', async () => {
    mockGetByPath({ matching: { overallStatus: 'TALLY_ERROR', errorMessage: 'Connection failed.' } });
    api.post.mockResolvedValue({ data: fullyMatched });
    withAuth(vendor);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(api.post).toHaveBeenCalledWith('/gst-filings/f1/tally-matching/run');
  });
});

describe('Phase 21 Vendor Final Document section', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the Vendor Final Document section with an Upload action once FULLY_MATCHED', async () => {
    mockGetByPath({ matching: fullyMatched });
    withAuth(vendor);
    expect(await screen.findByText('Vendor Final Document')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Final Document' })).toBeInTheDocument();
  });

  it('hides the Upload action when not yet FULLY_MATCHED (unauthorized-to-act state)', async () => {
    mockGetByPath({ matching: partialMatched });
    withAuth(vendor);
    expect(await screen.findByText('Vendor Final Document')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Final Document' })).toBeNull();
    expect(screen.getByText(/once this filing is fully matched/)).toBeInTheDocument();
  });

  it('a CLIENT_ADMIN (no upload permission) never sees the Upload action', async () => {
    mockGetByPath({ matching: fullyMatched });
    withAuth(clientAdmin);
    expect(await screen.findByText('Vendor Final Document')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload Final Document' })).toBeNull();
  });

  it('shows "No final document uploaded yet." when none exist', async () => {
    mockGetByPath({ matching: fullyMatched, finalDocs: [] });
    withAuth(vendor);
    expect(await screen.findByText('No final document uploaded yet.')).toBeInTheDocument();
  });

  it('renders an already-uploaded final document with its uploader label and a View action', async () => {
    mockGetByPath({ matching: fullyMatched, finalDocs: [{ id: 'd1', fileName: 'GST Final Bill.pdf', uploadedAt: '2026-10-08T00:00:00Z' }] });
    withAuth(vendor);
    expect(await screen.findByText('GST Final Bill.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by GST Vendor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Document' })).toBeInTheDocument();
  });

  it('uploading a final document calls the real upload endpoint and shows a success message', async () => {
    mockGetByPath({ matching: fullyMatched, finalDocs: [] });
    api.post.mockResolvedValue({ data: { finalDocuments: [{ id: 'd1', fileName: 'final.pdf', uploadedAt: '2026-10-08T00:00:00Z' }] } });
    withAuth(vendor);
    const uploadButton = await screen.findByRole('button', { name: 'Upload Final Document' });
    const file = new File(['bytes'], 'final.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, file);
    expect(uploadButton).toBeInTheDocument();
    expect(await screen.findByText('Final document uploaded successfully.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/gst-filings/f1/final-document', expect.objectContaining({
      documents: [expect.objectContaining({ fileName: 'final.pdf', mimeType: 'application/pdf' })],
    }));
  });

  it('upload error shows a clean error message, not a raw error', async () => {
    mockGetByPath({ matching: fullyMatched, finalDocs: [] });
    api.post.mockRejectedValue({ message: 'Tally matching must be fully matched before uploading the final document' });
    withAuth(vendor);
    await screen.findByRole('button', { name: 'Upload Final Document' });
    const file = new File(['bytes'], 'final.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input, file);
    expect(await screen.findByText('Tally matching must be fully matched before uploading the final document')).toBeInTheDocument();
  });

  it('clicking View Document retrieves it through the authenticated endpoint (never a public URL)', async () => {
    mockGetByPath({ matching: fullyMatched, finalDocs: [{ id: 'd1', fileName: 'final.pdf', uploadedAt: '2026-10-08T00:00:00Z' }] });
    api.getBlob.mockResolvedValue({ blob: new Blob(['x']) });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
    window.open = vi.fn();
    withAuth(vendor);
    await userEvent.click(await screen.findByRole('button', { name: 'View Document' }));
    expect(api.getBlob).toHaveBeenCalledWith('/gst-filings/f1/final-documents/d1');
  });
});
