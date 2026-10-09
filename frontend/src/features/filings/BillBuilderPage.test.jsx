import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { api } from '../../services/apiClient.js';
import BillBuilderPage from './BillBuilderPage.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: {
    get: vi.fn(), put: vi.fn(), post: vi.fn(), getBlob: vi.fn(),
  },
}));

const renderPage = () => render(
  <MemoryRouter initialEntries={['/client/gst-filings/f1/bill']}>
    <Routes>
      <Route path="/client/gst-filings/:id/bill" element={<BillBuilderPage />} />
    </Routes>
  </MemoryRouter>,
);

const savedBill = {
  items: [{ productName: 'Item', rate: '100.00' }], subtotal: '100.00', gstAmount: '18.00', grandTotal: '118.00', documents: [],
};

function mockGet({ profile = null, bill = null } = {}) {
  api.get.mockImplementation((path) => {
    if (path === '/business-profile') return profile ? Promise.resolve({ data: profile }) : Promise.reject({ status: 404 });
    if (path.endsWith('/bill')) return bill ? Promise.resolve({ data: bill }) : Promise.reject({ status: 404 });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('Phase 2.1 Bill Builder — Upload Bill staged select/upload/cancel flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('selecting a file only STAGES it — no upload call happens until "Upload" is clicked', async () => {
    mockGet({ bill: savedBill });
    renderPage();
    await screen.findByText('Upload Bill');
    const input = document.querySelector('input[type="file"]');
    const file = new File(['bytes'], 'bill.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);

    expect(await screen.findByText('bill.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('clicking Cancel discards the staged file without calling the server', async () => {
    mockGet({ bill: savedBill });
    renderPage();
    await screen.findByText('Upload Bill');
    const input = document.querySelector('input[type="file"]');
    const file = new File(['bytes'], 'bill.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await screen.findByText('bill.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('clicking Upload sends exactly one document and shows it as an uploaded document with a View action', async () => {
    mockGet({ bill: savedBill });
    api.post.mockResolvedValue({ data: { ...savedBill, documents: [{ id: 'd1', fileName: 'bill.pdf' }] } });
    renderPage();
    await screen.findByText('Upload Bill');
    const input = document.querySelector('input[type="file"]');
    const file = new File(['bytes'], 'bill.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, file);
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/gst-filings/f1/bill/documents', {
      documents: [expect.objectContaining({ fileName: 'bill.pdf', mimeType: 'application/pdf' })],
    });
    expect(await screen.findByText('Document uploaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('an oversized file is rejected immediately, without staging it or calling the server', async () => {
    mockGet({ bill: savedBill });
    renderPage();
    await screen.findByText('Upload Bill');
    const input = document.querySelector('input[type="file"]');
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await userEvent.upload(input, big);

    expect(await screen.findByText(/5MB or smaller/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});
