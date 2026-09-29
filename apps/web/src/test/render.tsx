import type { AuthUserResponse } from '@rag-ats/shared';
import { ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { type SessionStatus, useSessionStore } from '../auth/sessionStore';
import { routes } from '../router';
import { theme } from '../theme';

const initialSessionState = { status: 'loading' as const, user: null };

export function resetSessionStore() {
  useSessionStore.setState(initialSessionState);
}

interface RenderAppOptions {
  route?: string;
  session?: { status: SessionStatus; user: AuthUserResponse | null };
}

export function renderApp({ route = '/', session }: RenderAppOptions = {}) {
  useSessionStore.setState(session ?? { status: 'anonymous', user: null });

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [route] });

  const result = render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>,
  );

  return { ...result, router };
}
