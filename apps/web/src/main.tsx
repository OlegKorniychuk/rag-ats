import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { setUnauthorizedHandler } from './api/client';
import { bootstrapSession } from './auth/bootstrapSession';
import { useSessionStore } from './auth/sessionStore';
import { queryClient } from './queryClient';
import { router } from './router';
import { theme } from './theme';

setUnauthorizedHandler(() => {
  useSessionStore.getState().clear();
  queryClient.clear();
});

void bootstrapSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
