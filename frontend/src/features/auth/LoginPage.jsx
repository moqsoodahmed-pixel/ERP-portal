import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { roleHome } from '../../constants/roles.js';
import { LoadingState } from '../../components/states.jsx';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate({ email, password }) {
  const errors = {};
  if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

export default function LoginPage() {
  const { status, user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (status === 'loading') return <LoadingState label="Checking your session…" />;
  if (status === 'authenticated') return <Navigate to={location.state?.from ?? roleHome(user.role)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const signedIn = await login(form.email.trim(), form.password);
      navigate(location.state?.from ?? roleHome(signedIn.role), { replace: true });
    } catch (err) {
      if (err.status === 429) setError('Too many attempts. Please wait a few minutes and try again.');
      else if (err.status >= 500 || err.status === undefined) setError('The service is temporarily unavailable. Please try again shortly.');
      else setError('Invalid email or password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <section className="login__panel" aria-labelledby="login-title">
        <div className="brand brand--dark"><span className="brand__mark" aria-hidden="true" />ERP Platform</div>
        <h1 id="login-title">Sign in</h1>
        <p className="muted">GST billing, Tally sync and filing progress in one place.</p>
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span>Email</span>
            <input
              type="email" autoComplete="username" required value={form.email} aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined} onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            {fieldErrors.email && <span id="email-error" className="form-error" role="alert">{fieldErrors.email}</span>}
          </label>
          <label className="field">
            <span>Password</span>
            <span style={{ display: 'flex', gap: '.4rem' }}>
              <input
                style={{ flex: 1 }} type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={form.password}
                aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <button type="button" className="btn" aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
            {fieldErrors.password && <span id="password-error" className="form-error" role="alert">{fieldErrors.password}</span>}
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}