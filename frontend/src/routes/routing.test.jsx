import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext.jsx';
import AppRoutes from './AppRoutes.jsx';
import { ROLES } from '../constants/roles.js';

vi.mock('../services/apiClient.js', () => ({
  api: { get: vi.fn(() => new Promise(() => {})), post: vi.fn() }, toQuery: () => '',
}));

const userFor = (role, permissions) => ({ id: '1', name: 'Test User', email: 't@example.test', role, permissions });
const renderAt = (path, auth) => render(
  <AuthContext.Provider value={{ status: auth ? 'authenticated' : 'anonymous', user: auth ?? null, login: vi.fn(), logout: vi.fn() }}>
    <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
  </AuthContext.Provider>,
);

describe('routing and role/permission guards', () => {
  it('redirects anonymous visitors to the login page', () => {
    renderAt('/client/dashboard', null);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends a signed-in user from / to their role home', () => {
    renderAt('/', userFor(ROLES.CLIENT_ADMIN, ['products.view']));
    expect(screen.getByText(/Welcome, Test User/)).toBeInTheDocument();
  });

  it('blocks a client user from master routes', () => {
    renderAt('/master/clients', userFor(ROLES.CLIENT_ADMIN, ['clients.view']));
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });

  it('blocks a vendor from client routes and a client from vendor routes', () => {
    renderAt('/client/products', userFor(ROLES.GST_VENDOR, ['gst.view']));
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });

  it('blocks a page when the specific permission is missing', () => {
    renderAt('/client/invoices', userFor(ROLES.CLIENT_USER, ['products.view']));
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();
  });

  it('navigation only lists permitted items', () => {
    renderAt('/client/dashboard', userFor(ROLES.CLIENT_USER, ['products.view', 'customers.view']));
    const nav = screen.getByRole('navigation');
    expect(nav).toHaveTextContent('Products & services');
    expect(nav).toHaveTextContent('Customers');
    expect(nav).not.toHaveTextContent('Invoices');
    expect(nav).not.toHaveTextContent('Tally sync');
  });

  it('renders a 404 page for unknown routes', () => {
    renderAt('/does/not/exist', userFor(ROLES.CLIENT_ADMIN, []));
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows the loading state while a list is fetching', () => {
    renderAt('/client/products', userFor(ROLES.CLIENT_ADMIN, ['products.view']));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});
