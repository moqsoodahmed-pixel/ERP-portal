import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LoadingState } from '../components/states.jsx';
import ForbiddenPage from '../pages/ForbiddenPage.jsx';
import { can } from '../permissions/permissions.js';
import { roleHome } from '../constants/roles.js';

/** Route-level UX guard. Real enforcement happens on the server for every API call. */
export function RoleGuard({ roles, children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <LoadingState label="Checking your session…" />;
  if (status !== 'authenticated') return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <ForbiddenPage />;
  return children ?? <Outlet />;
}

export function RequirePermission({ permission, children }) {
  const { user } = useAuth();
  return can(user, permission) ? children : <ForbiddenPage />;
}

export function HomeRedirect() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingState label="Checking your session…" />;
  return <Navigate to={status === 'authenticated' ? roleHome(user.role) : '/auth/login'} replace />;
}
