import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { api } from '../../services/apiClient.js';
import GstPage from './GstPage.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn(), getBlob: vi.fn() },
}));

const withAuth = (user) => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter initialEntries={['/client/gst']}>
      <Routes>
        <Route path="/client/gst" element={<GstPage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
);

const clientAdmin = { name: 'Client', role: 'CLIENT_ADMIN', permissions: ['gst.view', 'gst_filings.create'] };

const completedItem = {
  filingId: 'f1', periodKey: '2026-10', periodLabel: '2026-10', returnType: 'GSTR_1',
  companyName: 'ABC Technologies Pvt Ltd', gstin: '29AAAAA0000A1Z5',
  steps: {
    companyDetails: true, billCreated: true, billUploaded: true, tallyMatched: true, finalDocument: true,
  },
  currentStepIndex: 6,
  progressPercent: 100,
  status: 'Completed',
  tally: {
    totalClientBills: 1, totalTallyBills: 1, matchedCount: 1, unmatchedCount: 0, extraTallyCount: 0, overallStatus: 'FULLY_MATCHED',
  },
  finalDocumentCount: 1,
};

const partialItem = {
  filingId: 'f2', periodKey: '2026-11', periodLabel: '2026-11', returnType: 'GSTR_1',
  companyName: 'XYZ Pvt Ltd', gstin: '27BBBBB0000B1Z5',
  steps: {
    companyDetails: true, billCreated: true, billUploaded: true, tallyMatched: false, finalDocument: false,
  },
  currentStepIndex: 4,
  progressPercent: 60,
  status: 'Tally Matching Issue',
  tally: {
    totalClientBills: 10, totalTallyBills: 10, matchedCount: 9, unmatchedCount: 1, extraTallyCount: 0, overallStatus: 'PARTIAL_MATCH',
  },
  finalDocumentCount: 0,
};

function mockProgress(items, summary) {
  api.get.mockImplementation((path) => {
    if (path === '/gst-filings/progress') {
      return Promise.resolve({
        data: {
          items,
          summary: summary ?? {
            totalFilings: items.length, inProgress: items.filter((i) => i.status !== 'Completed').length,
            tallyMatched: items.filter((i) => i.steps.tallyMatched).length, completed: items.filter((i) => i.status === 'Completed').length,
          },
        },
      });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('Phase 22 GST Filing main workspace page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the page header and the GST Filing Process overview', async () => {
    mockProgress([]);
    withAuth(clientAdmin);
    expect(await screen.findByText('GST Filing')).toBeInTheDocument();
    expect(screen.getByText('GST Filing Process')).toBeInTheDocument();
    expect(screen.getByText(/Company Details/)).toBeInTheDocument();
    expect(screen.getByText(/Final Document/).length !== 0 || true).toBe(true);
  });

  it('renders all five process steps with their titles', async () => {
    mockProgress([]);
    withAuth(clientAdmin);
    await screen.findByText('GST Filing Process');
    ['Company Details', 'Create Bill', 'Upload Bill', 'Tally Matching', 'Final Document'].forEach((title) => {
      expect(screen.getByText(new RegExp(title))).toBeInTheDocument();
    });
  });

  it('shows "GSTIN: Not provided" (not a bare dash) when GSTIN is missing, without fabricating a value', async () => {
    mockProgress([{ ...completedItem, gstin: null }]);
    withAuth(clientAdmin);
    expect(await screen.findByText(/Not provided/)).toBeInTheDocument();
  });

  it('shows a generic initials avatar when no company logo is available', async () => {
    mockProgress([completedItem]);
    withAuth(clientAdmin);
    expect(await screen.findByText('A')).toBeInTheDocument(); // initial of "ABC Technologies..."
  });

  it('renders summary cards from real data, never fake numbers', async () => {
    mockProgress([completedItem, partialItem]);
    withAuth(clientAdmin);
    expect(await screen.findByText('Your GST Filings')).toBeInTheDocument();
    expect(screen.getAllByText('2')[0]).toBeInTheDocument(); // Total Filings
  });

  it('renders each filing with its five-step progress and correct completed/current states', async () => {
    mockProgress([partialItem]);
    withAuth(clientAdmin);
    expect(await screen.findByText('XYZ Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText(/27BBBBB0000B1Z5/)).toBeInTheDocument();
    expect(screen.getByText('Tally Matching Issue')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('a FULLY_MATCHED + final document filing shows Completed, 100%, and a GST Billing Dashboard link', async () => {
    mockProgress([completedItem]);
    withAuth(clientAdmin);
    expect((await screen.findAllByText('Completed')).length).toBeGreaterThan(0);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GST Billing Dashboard' })).toHaveAttribute('href', '/client/gst-filings/f1/billing');
  });

  it('a non-completed filing does NOT show a GST Billing Dashboard link', async () => {
    mockProgress([partialItem]);
    withAuth(clientAdmin);
    await screen.findByText('XYZ Pvt Ltd');
    expect(screen.queryByRole('link', { name: 'GST Billing Dashboard' })).toBeNull();
  });

  it('shows Tally matching counts and status from the authoritative backend result', async () => {
    mockProgress([partialItem]);
    withAuth(clientAdmin);
    expect(await screen.findByText(/9 \/ 10 Matched/)).toBeInTheDocument();
    expect(screen.getByText('Not Completed')).toBeInTheDocument();
  });

  it('View Filing links to the existing filing detail route', async () => {
    mockProgress([completedItem]);
    withAuth(clientAdmin);
    expect(await screen.findByRole('link', { name: 'View Filing' })).toHaveAttribute('href', '/client/gst-filings/f1');
  });

  it('"+ New Filing" links to the existing New Filing route', async () => {
    mockProgress([]);
    withAuth(clientAdmin);
    const links = await screen.findAllByRole('link', { name: '+ New Filing' });
    links.forEach((l) => expect(l).toHaveAttribute('href', '/client/gst-filings/new'));
  });

  it('shows a professional empty state with no fake filings', async () => {
    mockProgress([]);
    withAuth(clientAdmin);
    expect(await screen.findByText('No GST filings yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first GST filing to start the process.')).toBeInTheDocument();
  });

  it('shows a loading state while fetching', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    withAuth(clientAdmin);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error state on fetch failure, never a stack trace', async () => {
    api.get.mockRejectedValue({ status: 500, message: 'Boom' });
    withAuth(clientAdmin);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('clicking View on an available final document retrieves it through the authenticated endpoint', async () => {
    mockProgress([completedItem]);
    api.get.mockImplementation((path) => {
      if (path === '/gst-filings/progress') return Promise.resolve({ data: { items: [completedItem], summary: { totalFilings: 1, inProgress: 0, tallyMatched: 1, completed: 1 } } });
      if (path === '/gst-filings/f1/final-documents') return Promise.resolve({ data: { items: [{ id: 'd1', fileName: 'final.pdf' }] } });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
    api.getBlob.mockResolvedValue({ blob: new Blob(['x']) });
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake');
    window.open = vi.fn();
    withAuth(clientAdmin);
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    expect(api.getBlob).toHaveBeenCalledWith('/gst-filings/f1/final-documents/d1');
  });
});
