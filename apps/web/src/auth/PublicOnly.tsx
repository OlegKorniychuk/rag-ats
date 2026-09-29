import { Navigate, Outlet } from 'react-router';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { useSessionStore } from './sessionStore';

export function PublicOnly() {
  const status = useSessionStore((state) => state.status);

  if (status === 'loading') {
    return <FullPageSpinner />;
  }

  if (status === 'authenticated') {
    return <Navigate to="/vacancies" replace />;
  }

  return <Outlet />;
}
