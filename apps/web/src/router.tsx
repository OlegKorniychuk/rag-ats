import type { RouteObject } from 'react-router';
import { createBrowserRouter, Navigate } from 'react-router';
import { PublicOnly } from './auth/PublicOnly';
import { RequireAuth } from './auth/RequireAuth';
import { ApplyPage } from './pages/ApplyPage';
import { CandidatePage } from './pages/CandidatePage';
import { CandidatesPage } from './pages/CandidatesPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PipelinePage } from './pages/PipelinePage';
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
      { path: '/vacancies/:id', element: <PipelinePage /> },
      { path: '/candidates', element: <CandidatesPage /> },
      { path: '/candidates/:id', element: <CandidatePage /> },
    ],
  },
  { path: '/apply/:token', element: <ApplyPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter(routes);
