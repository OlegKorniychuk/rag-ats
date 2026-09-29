import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { server } from '../test/server';
import { useUpdateApplicationStage, useVacancyApplications } from './queries';

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
  createdAt: '2024-01-01T00:00:00.000Z',
};

const application = {
  id: 'a1',
  vacancyId: 'v1',
  candidateId: 'c1',
  stage: 'applied',
  createdAt: '2024-01-01T00:00:00.000Z',
  candidate,
};

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
});
