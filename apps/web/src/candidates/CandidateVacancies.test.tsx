import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type {
  ApplicationScore,
  CandidateApplicationResponse,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { CandidateVacancies } from './CandidateVacancies';

const baseUrl = 'http://localhost:3000';

const pendingScore: ApplicationScore = {
  status: 'pending',
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
};

function makeApplication(
  overrides: Partial<CandidateApplicationResponse>,
): CandidateApplicationResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    vacancyTitle: 'Backend Dev',
    vacancyStatus: 'open',
    stage: 'applied',
    source: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    score: pendingScore,
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(<CandidateVacancies candidateId="c1" />, { wrapper: Wrapper });
}

function respondWith(applications: CandidateApplicationResponse[]) {
  server.use(
    http.get(`${baseUrl}/candidates/c1/applications`, () =>
      HttpResponse.json(applications),
    ),
  );
}

describe('CandidateVacancies', () => {
  it('lists each vacancy with a link, stage chip and score badge', async () => {
    respondWith([
      makeApplication({
        id: 'a1',
        vacancyId: 'v1',
        vacancyTitle: 'Backend Dev',
        stage: 'interview',
        score: {
          ...pendingScore,
          status: 'scored',
          result: {
            overall: 82,
            rationale: 'ok',
            criteria: [],
            cvDocumentId: 'cv1',
            model: 'gpt',
            mode: 'full_text',
            scoredAt: '2024-01-01T00:00:00.000Z',
          },
        },
      }),
      makeApplication({
        id: 'a2',
        vacancyId: 'v2',
        vacancyTitle: 'Designer',
        stage: 'applied',
      }),
    ]);
    renderSection();

    const section = screen.getByRole('region', { name: 'Vacancies' });
    expect(
      within(section).getByRole('heading', { name: 'Vacancies' }),
    ).toBeInTheDocument();

    const [first, second] = await within(section).findAllByRole('listitem');
    expect(
      within(first).getByRole('link', { name: 'Backend Dev' }),
    ).toHaveAttribute('href', '/vacancies/v1');
    expect(within(first).getByText('Interview')).toBeInTheDocument();
    expect(
      within(first).getByRole('img', { name: 'Fit score 82 of 100' }),
    ).toHaveTextContent('82');

    expect(
      within(second).getByRole('link', { name: 'Designer' }),
    ).toHaveAttribute('href', '/vacancies/v2');
    expect(within(second).getByText('Applied')).toBeInTheDocument();
    expect(
      within(second).getByRole('img', { name: 'Fit score: Scoring…' }),
    ).toHaveTextContent('Scoring…');
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows "Waiting for CV" for a score waiting on the parse', async () => {
    respondWith([
      makeApplication({ score: { ...pendingScore, waitingForParse: true } }),
    ]);
    renderSection();

    expect(
      await screen.findByRole('img', { name: 'Fit score: Waiting for CV' }),
    ).toHaveTextContent('Waiting for CV');
  });

  it('marks closed vacancies and added applications', async () => {
    respondWith([
      makeApplication({
        id: 'a1',
        vacancyTitle: 'Old role',
        vacancyStatus: 'closed',
        source: 'added',
      }),
      makeApplication({ id: 'a2', vacancyId: 'v2', vacancyTitle: 'Open role' }),
    ]);
    renderSection();

    await screen.findByRole('link', { name: 'Old role' });
    const [closedAdded, plain] = screen.getAllByRole('listitem');
    expect(within(closedAdded).getByText('Closed')).toBeInTheDocument();
    expect(within(closedAdded).getByText('Added')).toBeInTheDocument();
    expect(within(plain).queryByText('Closed')).not.toBeInTheDocument();
    expect(within(plain).queryByText('Added')).not.toBeInTheDocument();
  });

  it('shows an empty state when the candidate is on no vacancies', async () => {
    respondWith([]);
    renderSection();

    expect(
      await screen.findByText('Not on any of your vacancies yet'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('shows an error alert when loading fails', async () => {
    server.use(
      http.get(
        `${baseUrl}/candidates/c1/applications`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderSection();

    expect(
      await screen.findByText(/Could not load vacancies/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vacancies' })).toBeVisible();
  });
});
