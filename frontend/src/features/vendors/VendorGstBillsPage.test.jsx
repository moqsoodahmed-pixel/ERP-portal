import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import { api } from '../../services/apiClient.js';
import { VendorGstBillsPage } from './VendorsPages.jsx';

vi.mock('../../services/apiClient.js', () => ({
  api: { get: vi.fn(), getBlob: vi.fn() },
}));

const withAuth = (ui, user) => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter>{ui}</MemoryRouter>
  </AuthContext.Provider>,
);

const vendor = { name: 'Vendor', role: 'GST_VENDOR', permissions: ['gst_bills.view'] };

const page1 = {
  items: [
    {
      filingId: 'f1',
      companyId: 'T-A',
      companyName: 'ABC Pvt Ltd',
      gstin: '29AAAAA0000A1Z5',
      address: { line1: 'No. 1, MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
      documents: [{ id: 'd1', fileName: 'bill.pdf', mimeType: 'application/pdf' }],
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

describe('Phase 19.3 Vendor GST Bills page (client bill handoff to vendor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    window.open = vi.fn();
  });

  it('renders the four required columns with company and uploaded-bill data', async () => {
    api.get.mockResolvedValue({ data: page1 });
    withAuth(<VendorGstBillsPage />, vendor);
    expect(await screen.findByText('T-A')).toBeInTheDocument();
    expect(screen.getByText('ABC Pvt Ltd')).toBeInTheDocument();
    expect(screen.getByText(/29AAAAA0000A1Z5/)).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Bill' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company ID' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Company Details' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Client Uploaded Bill' })).toBeInTheDocument();
  });

  it('shows a loading state while fetching', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    withAuth(<VendorGstBillsPage />, vendor);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a professional empty state with no placeholder data when no bills exist', async () => {
    api.get.mockResolvedValue({ data: { items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } } });
    withAuth(<VendorGstBillsPage />, vendor);
    expect(await screen.findByText('No client bills available')).toBeInTheDocument();
  });

  it('shows an error state on fetch failure', async () => {
    api.get.mockRejectedValue({ status: 500, message: 'Boom' });
    withAuth(<VendorGstBillsPage />, vendor);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('clicking "View Bill" retrieves the document through the authenticated document endpoint (never a public URL)', async () => {
    api.get.mockResolvedValue({ data: page1 });
    api.getBlob.mockResolvedValue({ blob: new Blob(['x']) });
    withAuth(<VendorGstBillsPage />, vendor);
    await userEvent.click(await screen.findByRole('button', { name: 'View Bill' }));
    expect(api.getBlob).toHaveBeenCalledWith('/gst-filings/f1/bill/documents/d1');
  });
});
