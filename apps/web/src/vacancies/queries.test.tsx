import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { server } from '../test/server';
import { useCreateVacancy, useUpdateVacancy, useVacancies } from './queries';

const baseUrl = 'http://localhost:3000';

const vacancy = {
  id: '1',
  recruiterId: 'r1',
  title: 'Engineer',
  requirements: 'TS',
  applyToken: 'tok',
  status: 'open',
  createdAt: '2024-01-01T00:00:00.000Z',
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

describe('vacancies queries', () => {
  it('useVacancies returns the list', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
    );

    const { result } = renderHook(() => useVacancies(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual([vacancy]));
  });

  it('useCreateVacancy refetches the vacancies list on success', async () => {
    let vacancies = [vacancy];
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.post(`${baseUrl}/vacancies`, async ({ request }) => {
        const body = (await request.json()) as {
          title: string;
          requirements: string;
        };
        const created = { ...vacancy, id: '2', ...body };
        vacancies = [...vacancies, created];
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const { result } = renderHook(
      () => ({ list: useVacancies(), create: useCreateVacancy() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.list.data).toEqual([vacancy]));

    await act(async () => {
      await result.current.create.mutateAsync({
        title: 'New role',
        requirements: 'Req',
      });
    });

    await waitFor(() => expect(result.current.list.data).toHaveLength(2));
  });

  it('useUpdateVacancy refetches the vacancies list on success', async () => {
    let vacancies = [vacancy];
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json(vacancies)),
      http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
        const body = (await request.json()) as { status?: string };
        vacancies = vacancies.map((v) =>
          v.id === '1' ? { ...v, ...body } : v,
        );
        return HttpResponse.json(vacancies[0]);
      }),
    );

    const { result } = renderHook(
      () => ({ list: useVacancies(), update: useUpdateVacancy() }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.list.data).toEqual([vacancy]));

    await act(async () => {
      await result.current.update.mutateAsync({
        id: '1',
        body: { status: 'closed' },
      });
    });

    await waitFor(() =>
      expect(result.current.list.data?.[0].status).toBe('closed'),
    );
  });
});
