import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { useSessionStore } from './sessionStore';

interface RedirectState {
  from?: { pathname: string; search: string };
}

export function PublicOnly() {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageSpinner />;
  }

  if (status === 'authenticated') {
    const from = (location.state as RedirectState | null)?.from;
    const target = from ? `${from.pathname}${from.search}` : '/vacancies';
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
