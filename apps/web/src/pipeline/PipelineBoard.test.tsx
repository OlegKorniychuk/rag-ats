import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type {
  ApplicationStage,
  ApplicationWithCandidateResponse,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { createDragEndHandler } from './dragEnd';
import { PipelineBoard } from './PipelineBoard';
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
  cv: {
    id: 'cv1',
    filename: 'cv.pdf',
    sizeBytes: 1024,
    uploadedAt: '2024-01-01T00:00:00.000Z',
  },
  parseStatus: 'parsed' as const,
  parseError: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

function makeApplication(
  overrides: Partial<ApplicationWithCandidateResponse>,
): ApplicationWithCandidateResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    candidateId: 'c1',
    stage: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate,
    ...overrides,
  };
}

function fakeDragEndEvent(
  activeId: string,
  overId: string | null,
): DragEndEvent {
  return {
    active: { id: activeId, data: { current: undefined }, rect: {} },
    over: overId
      ? { id: overId, disabled: false, data: { current: undefined }, rect: {} }
      : null,
    activatorEvent: new Event('pointerup'),
    collisions: null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent;
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

// Drives createDragEndHandler directly with the live mutation hook, bypassing
// real pointer/keyboard DnD simulation (unreliable in jsdom).
function Harness({
  vacancyId,
  onError,
}: {
  vacancyId: string;
  onError: (message: string) => void;
}) {
  const { data } = useVacancyApplications(vacancyId);
  const updateStage = useUpdateApplicationStage(vacancyId);
  if (!data) return null;
  const handleDragEnd = createDragEndHandler(data, updateStage, onError);
  return (
    <>
      <button onClick={() => handleDragEnd(fakeDragEndEvent('a1', 'screened'))}>
        drop into screened
      </button>
      <PipelineBoard
        vacancyId={vacancyId}
        applications={data}
        onError={onError}
      />
    </>
  );
}

describe('PipelineBoard drag end integration', () => {
  it('moves the card to the new column after a valid drop', async () => {
    let applications = [makeApplication({ id: 'a1', stage: 'applied' })];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json(applications),
      ),
      http.patch(`${baseUrl}/applications/a1`, async ({ request }) => {
        const body = (await request.json()) as { stage: ApplicationStage };
        applications = applications.map((application) =>
          application.id === 'a1'
            ? { ...application, stage: body.stage }
            : application,
        );
        return HttpResponse.json(applications[0]);
      }),
    );
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness vacancyId="v1" onError={vi.fn()} />
      </Wrapper>,
    );

    await screen.findByText('Ada');
    expect(
      within(screen.getByRole('region', { name: 'Applied' })).getByText('Ada'),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'drop into screened' }),
    );

    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Screened' })).getByText(
          'Ada',
        ),
      ).toBeInTheDocument(),
    );
  });

  it('reverts to the original column and reports the error when the PATCH fails', async () => {
    const application = makeApplication({ id: 'a1', stage: 'applied' });
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([application]),
      ),
      http.patch(`${baseUrl}/applications/a1`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    const onError = vi.fn();
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <Harness vacancyId="v1" onError={onError} />
      </Wrapper>,
    );

    await screen.findByText('Ada');
    await userEvent.click(
      screen.getByRole('button', { name: 'drop into screened' }),
    );

    await waitFor(() => expect(onError).toHaveBeenCalledWith('boom'));
    expect(
      within(screen.getByRole('region', { name: 'Applied' })).getByText('Ada'),
    ).toBeInTheDocument();
  });
});
