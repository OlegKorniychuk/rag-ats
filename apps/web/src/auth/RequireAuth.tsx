import { Navigate, useLocation } from 'react-router';
import { FullPageSpinner } from '../components/FullPageSpinner';
import { AppLayout } from '../layout/AppLayout';
import { useSessionStore } from './sessionStore';

export function RequireAuth() {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();

  if (status === 'loading') {
    return <FullPageSpinner />;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <AppLayout />;
}
