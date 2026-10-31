import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type {
  ApplicationScore,
  CandidateApplicationResponse,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { candidateKeys, useCandidateApplications } from './queries';

vi.mock('../pipeline/score', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pipeline/score')>()),
  SCORE_POLL_INTERVAL_MS: 50,
}));

const baseUrl = 'http://localhost:3000';

const score = (status: ApplicationScore['status']): ApplicationScore => ({
  status,
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
});

const application = (
  status: ApplicationScore['status'],
): CandidateApplicationResponse => ({
  id: 'a1',
  vacancyId: 'v1',
  vacancyTitle: 'Backend Dev',
  vacancyStatus: 'open',
  stage: 'applied',
  source: 'added',
  createdAt: '2024-01-01T00:00:00.000Z',
  score: score(status),
});

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('candidate queries', () => {
  it('nests the applications key under the candidate detail key', () => {
    expect(candidateKeys.applications('c1').slice(0, 2)).toEqual(
      candidateKeys.detail('c1'),
    );
  });

  it('useCandidateApplications polls while a score is in flight and stops once settled', async () => {
    let calls = 0;
    server.use(
      http.get(`${baseUrl}/candidates/c1/applications`, () => {
        calls += 1;
        return HttpResponse.json([
          application(calls === 1 ? 'scoring' : 'scored'),
        ]);
      }),
    );

    const { result } = renderHook(() => useCandidateApplications('c1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() =>
      expect(result.current.data?.[0].score.status).toBe('scored'),
    );
    expect(calls).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(2);
  });
});
