import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext.jsx';
import NotificationBell, { linkFor, POLL_MS } from './NotificationBell.jsx';
import { api } from '../services/apiClient.js';

vi.mock('../services/apiClient.js', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));

const user = { id: 'u1', name: 'Admin', role: 'CLIENT_ADMIN', permissions: ['invoices.view', 'dashboard.view'] };
const items = [
  { _id: 'n1', title: 'Invoice INV-000001 issued', message: 'Final now', severity: 'INFO', isRead: false, createdAt: '2026-04-01T10:00:00Z', actionUrl: '/client/invoices/abc' },
  { _id: 'n2', title: 'GST filing 2026-04 ready', severity: 'CRITICAL', isRead: false, createdAt: '2026-04-01T09:00:00Z', actionUrl: '/client/gst-filings/f1' },
];
const renderBell = () => render(
  <AuthContext.Provider value={{ status: 'authenticated', user, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter><NotificationBell /></MemoryRouter>
  </AuthContext.Provider>,
);

describe('NotificationBell', () => {
  beforeEach(() => {
    api.get.mockReset(); api.patch.mockReset();
    api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/notifications/unread-count') ? { data: { unread: 2 } } : { data: { items } }));
  });

  it('shows the unread badge and polls the unread count every 30 seconds', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    renderBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), POLL_MS);
    expect(POLL_MS).toBe(30000);
    spy.mockRestore();
  });

  it('lists recent notifications; links only where the user may open the target; marks one read', async () => {
    api.patch.mockResolvedValue({ data: { ...items[0], isRead: true, readAt: '2026-04-02T00:00:00Z' } });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    expect(await screen.findByRole('link', { name: 'Invoice INV-000001 issued' })).toHaveAttribute('href', '/client/invoices/abc');
    expect(screen.getByText('GST filing 2026-04 ready').closest('a')).toBeNull(); // no gst_filings.view -> no link
    expect(screen.getByText('critical')).toHaveClass('badge--bad');
    await userEvent.click(screen.getByRole('button', { name: 'Mark "Invoice INV-000001 issued" as read' }));
    expect(api.patch).toHaveBeenCalledWith('/notifications/n1/read');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument());
  });

  it('marks all read', async () => {
    api.patch.mockResolvedValue({ data: { updated: 2 } });
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all read' }));
    expect(api.patch).toHaveBeenCalledWith('/notifications/read-all');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument());
  });

  it('renders empty and error states', async () => {
    api.get.mockImplementation((path) => Promise.resolve(path.startsWith('/notifications/unread-count') ? { data: { unread: 0 } } : { data: { items: [] } }));
    const { unmount } = renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText('You have no notifications yet.')).toBeInTheDocument();
    unmount();
    api.get.mockImplementation((path) => (path.startsWith('/notifications/unread-count') ? Promise.resolve({ data: { unread: 0 } }) : Promise.reject(new Error('boom'))));
    renderBell();
    await userEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load notifications');
  });

  it('linkFor never links outside the user\'s own area or without the route permission', () => {
    expect(linkFor(user, '/client/invoices/1')).toBe('/client/invoices/1');
    expect(linkFor(user, '/vendor/filings/1')).toBeNull();
    expect(linkFor(user, '/client/gst-filings/1')).toBeNull();
    expect(linkFor({ role: 'GST_VENDOR', permissions: ['gst_filings.view'] }, '/vendor/filings/1')).toBe('/vendor/filings/1');
    expect(linkFor(user, null)).toBeNull();
  });
});
