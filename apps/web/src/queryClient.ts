import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';

const MAX_RETRIES = 3;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx won't change on retry; only retry network errors and 5xx
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status < 500) &&
        failureCount < MAX_RETRIES,
    },
  },
});
