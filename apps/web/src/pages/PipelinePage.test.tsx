import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { server } from '../test/server';
import { renderApp } from '../test/render';
import { ADDED_FROM_POOL_LABEL as ADDED } from '../candidates/AddedFromPoolIcon';

vi.mock('../pipeline/score', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pipeline/score')>()),
  SCORE_POLL_INTERVAL_MS: 50,
}));

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};

const vacancy = {
  id: 'v1',
  recruiterId: 'r1',
  title: 'Backend Dev',
  requirements: 'TS',
  applyToken: 'tok-123',
  status: 'open' as const,
  createdAt: '2024-01-15T00:00:00.000Z',
};

function makeCandidate(
  overrides: Partial<ApplicationWithCandidateResponse['candidate']>,
) {
  return {
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    githubUrl: null,
    portfolioUrl: null,
    skills: ['TS', 'React'],
    experience: '5 years',
    projects: [],
    summary: '',
    cv: {
      id: 'cv1',
      filename: 'cv.pdf',
      sizeBytes: 1024,
      uploadedAt: '2024-01-01T00:00:00.000Z',
    },
    parseStatus: 'parsed' as const,
    github: null,
    parseError: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeApplication(
  overrides: Partial<ApplicationWithCandidateResponse>,
): ApplicationWithCandidateResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    candidateId: 'c1',
    stage: 'applied',
    source: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate: makeCandidate({}),
    score: {
      status: 'pending',
      error: null,
      waitingForParse: false,
      stale: false,
      result: null,
    },
    ...overrides,
  };
}

function scoreResult(overall: number) {
  return {
    overall,
    rationale: 'Because.',
    criteria: [],
    cvDocumentId: 'cv1',
    model: 'gpt-test',
    mode: 'full_text' as const,
    scoredAt: '2024-03-10T00:00:00.000Z',
  };
}

describe('PipelinePage', () => {
  it('shows the vacancy header, status chip, cards in stage regions and counts', async () => {
    const applied = makeApplication({
      id: 'a1',
      stage: 'applied',
      candidateId: 'c1',
      candidate: makeCandidate({ id: 'c1', name: 'Ada Lovelace' }),
    });
    const hired = makeApplication({
      id: 'a2',
      stage: 'hired',
      candidateId: 'c2',
      candidate: makeCandidate({ id: 'c2', name: 'Grace Hopper' }),
    });
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([applied, hired]),
      ),
    );

    renderApp({ route: '/vacancies/v1', session });

    expect(
      await screen.findByRole('heading', { name: 'Backend Dev' }),
    ).toBeInTheDocument();
    expect(screen.getByText('open')).toBeInTheDocument();

    const appliedColumn = screen.getByRole('region', { name: 'Applied' });
    expect(within(appliedColumn).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(appliedColumn).getByText('1')).toBeInTheDocument();

    const hiredColumn = screen.getByRole('region', { name: 'Hired' });
    expect(within(hiredColumn).getByText('Grace Hopper')).toBeInTheDocument();
    expect(within(hiredColumn).getByText('1')).toBeInTheDocument();

    const screenedColumn = screen.getByRole('region', { name: 'Screened' });
    expect(
      within(screenedColumn).getByText('No applicants'),
    ).toBeInTheDocument();
  });

  it('shows an empty-state hint and all five columns with zero applications', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([]),
      ),
    );

    renderApp({ route: '/vacancies/v1', session });

    expect(
      await screen.findByText(
        'No applicants yet — share the apply link to get started',
      ),
    ).toBeInTheDocument();

    for (const label of [
      'Applied',
      'Screened',
      'Interview',
      'Rejected',
      'Hired',
    ]) {
      expect(screen.getByRole('region', { name: label })).toBeInTheDocument();
    }
  });

  it('shows "Vacancy not found" for a 404', async () => {
    server.use(
      http.get(
        `${baseUrl}/vacancies/v1`,
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([]),
      ),
    );

    renderApp({ route: '/vacancies/v1', session });

    expect(await screen.findByText('Vacancy not found')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '← Vacancies' }),
    ).toBeInTheDocument();
  });

  it('navigates to the candidate page when a card is clicked', async () => {
    const candidate = makeCandidate({ id: 'c1', name: 'Ada Lovelace' });
    const applied = makeApplication({
      id: 'a1',
      stage: 'applied',
      candidateId: 'c1',
      candidate,
    });
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([applied]),
      ),
      http.get(`${baseUrl}/candidates/c1`, () => HttpResponse.json(candidate)),
    );

    const { router } = renderApp({ route: '/vacancies/v1', session });

    await screen.findByText('Ada Lovelace');
    await userEvent.click(screen.getByText('Ada Lovelace'));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/candidates/c1'),
    );
    expect(
      await screen.findByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
  });

  it('shows a parse status chip on unparsed cards only', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([
          makeApplication({
            id: 'a1',
            candidate: makeCandidate({ id: 'c1', parseStatus: 'parsing' }),
          }),
          makeApplication({
            id: 'a2',
            candidateId: 'c2',
            candidate: makeCandidate({ id: 'c2', name: 'Grace Hopper' }),
          }),
        ]),
      ),
    );
    renderApp({ route: '/vacancies/v1', session });

    expect(await screen.findByText('Parsing…')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^CV parsing/)).toHaveLength(1);
  });

  it('marks cards added from the pool only', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([
          makeApplication({
            id: 'a1',
            source: 'added',
            candidate: makeCandidate({ id: 'c1', name: 'Ada Lovelace' }),
          }),
          makeApplication({
            id: 'a2',
            source: 'applied',
            candidateId: 'c2',
            candidate: makeCandidate({ id: 'c2', name: 'Grace Hopper' }),
          }),
        ]),
      ),
    );
    renderApp({ route: '/vacancies/v1', session });

    const ada = (await screen.findByText('Ada Lovelace')).closest(
      '.MuiCard-root',
    );
    const grace = screen.getByText('Grace Hopper').closest('.MuiCard-root');
    expect(ada).not.toBeNull();
    expect(grace).not.toBeNull();
    expect(
      within(ada as HTMLElement).getByRole('img', { name: ADDED }),
    ).toBeInTheDocument();
    expect(
      within(grace as HTMLElement).queryByRole('img', { name: ADDED }),
    ).not.toBeInTheDocument();
  });

  it('sorts cards by score within a column, unscored last', async () => {
    const scored = (overall: number) => ({
      status: 'scored' as const,
      error: null,
      waitingForParse: false,
      stale: false,
      result: scoreResult(overall),
    });
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([
          makeApplication({
            id: 'a1',
            candidateId: 'c1',
            candidate: makeCandidate({ id: 'c1', name: 'Unscored Una' }),
          }),
          makeApplication({
            id: 'a2',
            candidateId: 'c2',
            candidate: makeCandidate({ id: 'c2', name: 'Low Larry' }),
            score: scored(30),
          }),
          makeApplication({
            id: 'a3',
            candidateId: 'c3',
            candidate: makeCandidate({ id: 'c3', name: 'High Hana' }),
            score: scored(90),
          }),
        ]),
      ),
    );
    renderApp({ route: '/vacancies/v1', session });

    await screen.findByText('High Hana');
    const column = screen.getByRole('region', { name: 'Applied' });
    const names = within(column)
      .getAllByText(/Una|Larry|Hana/)
      .map((node) => node.textContent);
    expect(names).toEqual(['High Hana', 'Low Larry', 'Unscored Una']);
  });

  it('opens the score drawer for a card without navigating', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([
          makeApplication({
            id: 'a1',
            candidate: makeCandidate({ id: 'c1', name: 'Ada Lovelace' }),
            score: {
              status: 'scored',
              error: null,
              waitingForParse: false,
              stale: false,
              result: scoreResult(77),
            },
          }),
          makeApplication({
            id: 'a2',
            candidateId: 'c2',
            candidate: makeCandidate({ id: 'c2', name: 'Grace Hopper' }),
          }),
        ]),
      ),
    );
    const { router } = renderApp({ route: '/vacancies/v1', session });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Fit score 77 of 100' }),
    );

    const drawer = await screen.findByRole('presentation');
    expect(
      within(drawer).getByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(within(drawer).getByText('Fit for Backend Dev')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/vacancies/v1');
  });

  it('polls while a score is pending and stops once it is scored', async () => {
    let calls = 0;
    server.use(
      http.get(`${baseUrl}/vacancies/v1`, () => HttpResponse.json(vacancy)),
      http.get(`${baseUrl}/vacancies/v1/applications`, () => {
        calls += 1;
        return HttpResponse.json([
          makeApplication({
            score:
              calls === 1
                ? {
                    status: 'scoring',
                    error: null,
                    waitingForParse: false,
                    stale: false,
                    result: null,
                  }
                : {
                    status: 'scored',
                    error: null,
                    waitingForParse: false,
                    stale: false,
                    result: scoreResult(64),
                  },
          }),
        ]);
      }),
    );
    renderApp({ route: '/vacancies/v1', session });

    expect(await screen.findByText('Scoring…')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Fit score 64 of 100' }),
    ).toBeInTheDocument();

    const settled = calls;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(settled);
  });
});
