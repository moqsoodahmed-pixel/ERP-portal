import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext.jsx';
import LoginPage from './LoginPage.jsx';

const renderLogin = (login = vi.fn()) => render(
  <AuthContext.Provider value={{ status: 'anonymous', user: null, login, logout: vi.fn() }}>
    <MemoryRouter><LoginPage /></MemoryRouter>
  </AuthContext.Provider>,
);

describe('LoginPage', () => {
  it('validates input before calling the API', async () => {
    const login = vi.fn();
    renderLogin(login);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('toggles password visibility', async () => {
    renderLogin();
    const input = screen.getByLabelText('Password', { selector: 'input' });
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('shows a generic error for rejected credentials and a loading state while submitting', async () => {
    const login = vi.fn().mockRejectedValue({ status: 401 });
    renderLogin(login);
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.test');
    await userEvent.type(screen.getByLabelText('Password', { selector: 'input' }), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith('someone@example.test', 'wrong');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });
});