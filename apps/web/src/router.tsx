import type { RouteObject } from 'react-router';
import { createBrowserRouter, Navigate } from 'react-router';
import { PublicOnly } from './auth/PublicOnly';
import { RequireAuth } from './auth/RequireAuth';
import { ApplyPage } from './pages/ApplyPage';
import { CandidatesPage } from './pages/CandidatesPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { VacanciesPage } from './pages/VacanciesPage';

export const routes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { index: true, element: <Navigate to="/vacancies" replace /> },
      { path: '/vacancies', element: <VacanciesPage /> },
      { path: '/candidates', element: <CandidatesPage /> },
    ],
  },
  { path: '/apply/:token', element: <ApplyPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createBrowserRouter(routes);
