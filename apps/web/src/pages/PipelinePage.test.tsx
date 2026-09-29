import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { server } from '../test/server';
import { renderApp } from '../test/render';

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
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate: makeCandidate({}),
    ...overrides,
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
});
