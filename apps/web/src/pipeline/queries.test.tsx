import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCandidateApplications } from '../candidates/queries';
import { server } from '../test/server';
import {
  useAddMatch,
  useUpdateApplicationStage,
  useVacancyApplications,
  useVacancyMatches,
} from './queries';

vi.mock('./score', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./score')>()),
  SCORE_POLL_INTERVAL_MS: 50,
  BOARD_IDLE_POLL_INTERVAL_MS: 1000,
}));

const baseUrl = 'http://localhost:3000';

const candidate = {
  id: 'c1',
  name: 'Ada',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: [],
  experience: '',
  projects: [],
  summary: '',
  parseStatus: 'parsed',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const application = {
  id: 'a1',
  vacancyId: 'v1',
  candidateId: 'c1',
  stage: 'applied',
  source: 'applied',
  createdAt: '2024-01-01T00:00:00.000Z',
  candidate,
  // settled, so only the (slower) idle poll interval below refetches it
  score: {
    status: 'scored',
    error: null,
    waitingForParse: false,
    stale: false,
    result: null,
  },
};

const pendingScore = { ...application.score, status: 'pending' };

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

describe('pipeline queries', () => {
  it('useVacancyApplications returns the list', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([application]),
      ),
    );

    const { result } = renderHook(() => useVacancyApplications('v1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([application]));
  });

  it('useVacancyApplications keeps polling while a score is pending', async () => {
    let calls = 0;
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        calls += 1;
        return HttpResponse.json([{ ...application, score: pendingScore }]);
      }),
    );

    renderHook(() => useVacancyApplications('v1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(3));
  });

  it('useVacancyApplications keeps refetching a settled board at the idle interval', async () => {
    const times: number[] = [];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        times.push(Date.now());
        return HttpResponse.json([application]);
      }),
    );

    renderHook(() => useVacancyApplications('v1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(times.length).toBeGreaterThanOrEqual(3), {
      timeout: 5000,
    });
    // idle (1000 ms), not the 50 ms score interval and not off
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(800);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(800);
  });

  it('useVacancyApplications uses the fast interval, not the idle one, while a score is pending', async () => {
    const times: number[] = [];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        times.push(Date.now());
        return HttpResponse.json([{ ...application, score: pendingScore }]);
      }),
    );

    renderHook(() => useVacancyApplications('v1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(times.length).toBeGreaterThanOrEqual(4));
    // four fetches fit well inside a single idle interval
    expect(times[3] - times[0]).toBeLessThan(1000);
  });

  it('useVacancyApplications falls back to the idle interval for a score waiting on a failed parse', async () => {
    const times: number[] = [];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        times.push(Date.now());
        return HttpResponse.json([
          {
            ...application,
            candidate: { ...candidate, parseStatus: 'failed' },
            score: { ...pendingScore, waitingForParse: true },
          },
        ]);
      }),
    );

    renderHook(() => useVacancyApplications('v1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(times.length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    // refetches (not off) but slowly (not the 50 ms in-flight interval)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(800);
  });

  it('applies the new stage optimistically before the response resolves', async () => {
    let getCalls = 0;
    let resolvePatch: (() => void) | undefined;
    const patchStarted = new Promise<void>((resolve) => {
      resolvePatch = resolve;
    });
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        getCalls += 1;
        return HttpResponse.json([application]);
      }),
      http.patch(`${baseUrl}/applications/a1`, async () => {
        resolvePatch?.();
        await new Promise(() => {});
        return HttpResponse.json({ ...application, stage: 'screened' });
      }),
    );

    const { result } = renderHook(
      () => ({
        list: useVacancyApplications('v1'),
        update: useUpdateApplicationStage('v1'),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(result.current.list.data).toEqual([application]),
    );

    act(() => {
      result.current.update.mutate({ id: 'a1', stage: 'screened' });
    });

    await act(async () => {
      await patchStarted;
    });

    await waitFor(() =>
      expect(result.current.list.data?.[0].stage).toBe('screened'),
    );
    expect(getCalls).toBe(1);
  });

  it('rolls back the cache when the PATCH fails', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([application]),
      ),
      http.patch(`${baseUrl}/applications/a1`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => ({
        list: useVacancyApplications('v1'),
        update: useUpdateApplicationStage('v1'),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(result.current.list.data).toEqual([application]),
    );

    await act(async () => {
      await result.current.update
        .mutateAsync({ id: 'a1', stage: 'screened' })
        .catch(() => undefined);
    });

    await waitFor(() =>
      expect(result.current.list.data?.[0].stage).toBe('applied'),
    );
  });

  it('refetches the applications list on success', async () => {
    let getCalls = 0;
    let applications = [application];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        getCalls += 1;
        return HttpResponse.json(applications);
      }),
      http.patch(`${baseUrl}/applications/a1`, async ({ request }) => {
        const body = (await request.json()) as { stage: string };
        applications = applications.map((a) =>
          a.id === 'a1' ? { ...a, stage: body.stage } : a,
        );
        return HttpResponse.json({ ...application, stage: body.stage });
      }),
    );

    const { result } = renderHook(
      () => ({
        list: useVacancyApplications('v1'),
        update: useUpdateApplicationStage('v1'),
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() =>
      expect(result.current.list.data).toEqual([application]),
    );
    expect(getCalls).toBe(1);

    await act(async () => {
      await result.current.update.mutateAsync({ id: 'a1', stage: 'screened' });
    });

    await waitFor(() => expect(getCalls).toBe(2));
    expect(result.current.list.data?.[0].stage).toBe('screened');
  });

  it('useVacancyMatches does not fetch while disabled', async () => {
    let getCalls = 0;
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, () => {
        getCalls += 1;
        return HttpResponse.json({ mode: 'criteria', matches: [] });
      }),
    );

    const { result, rerender } = renderHook(
      ({ enabled }) => useVacancyMatches('v1', { enabled }),
      { wrapper: createWrapper(), initialProps: { enabled: false } },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(getCalls).toBe(0);
    expect(result.current.fetchStatus).toBe('idle');

    rerender({ enabled: true });
    await waitFor(() =>
      expect(result.current.data).toEqual({ mode: 'criteria', matches: [] }),
    );
    expect(getCalls).toBe(1);
  });

  it('useAddMatch posts the candidate and refetches matches, applications and candidate applications', async () => {
    const calls = { matches: 0, applications: 0, candidateApplications: 0 };
    let body: unknown;
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, () => {
        calls.matches += 1;
        return HttpResponse.json({ mode: 'criteria', matches: [] });
      }),
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        calls.applications += 1;
        return HttpResponse.json([]);
      }),
      http.get(`${baseUrl}/candidates/c1/applications`, () => {
        calls.candidateApplications += 1;
        return HttpResponse.json([]);
      }),
      http.post(`${baseUrl}/vacancies/v1/applications`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(application, { status: 201 });
      }),
    );
    const onAdded = vi.fn();

    const { result } = renderHook(
      () => ({
        matches: useVacancyMatches('v1', { enabled: true }),
        list: useVacancyApplications('v1'),
        candidateApplications: useCandidateApplications('c1'),
        add: useAddMatch('v1', onAdded),
      }),
      { wrapper: createWrapper() },
    );
    await waitFor(() =>
      expect(calls).toEqual({
        matches: 1,
        applications: 1,
        candidateApplications: 1,
      }),
    );

    await act(async () => {
      await result.current.add.mutateAsync('c1');
    });

    expect(body).toEqual({ candidateId: 'c1' });
    expect(onAdded).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(calls).toEqual({
        matches: 2,
        applications: 2,
        candidateApplications: 2,
      }),
    );
  });
});
