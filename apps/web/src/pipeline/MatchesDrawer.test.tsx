import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { MemoryRouter } from 'react-router';
import type {
  CandidateResponse,
  CriterionMatch,
  VacancyMatch,
  VacancyMatchesResponse,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { theme } from '../theme';
import { MatchesDrawer } from './MatchesDrawer';

const baseUrl = 'http://localhost:3000';

function makeCandidate(
  overrides: Partial<CandidateResponse>,
): CandidateResponse {
  return {
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    githubUrl: null,
    portfolioUrl: null,
    skills: ['kubernetes', 'terraform', 'go', 'rust', 'sql', 'react', 'node'],
    experience: '5 years',
    projects: [],
    summary: '',
    cv: {
      id: 'cv1',
      filename: 'cv.pdf',
      sizeBytes: 1024,
      uploadedAt: '2024-01-01T00:00:00.000Z',
    },
    parseStatus: 'parsed',
    github: null,
    parseError: null,
    createdAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

const criteria: CriterionMatch[] = [
  {
    criterionId: 'k1',
    criterion: 'Runs Kubernetes in production',
    importance: 'must',
    similarity: 0.62,
    matched: true,
  },
  {
    criterionId: 'k2',
    criterion: 'Writes Terraform',
    importance: 'nice',
    similarity: 0.41,
    matched: true,
  },
  {
    criterionId: 'k3',
    criterion: 'Knows Python',
    importance: 'nice',
    similarity: null,
    matched: false,
  },
];

const ada: VacancyMatch = {
  candidate: makeCandidate({}),
  score: 0.7,
  criteria,
  snippets: [
    {
      source: 'cv',
      text: 'Operated Kubernetes clusters',
      similarity: 0.62,
      criterionId: 'k1',
    },
    {
      source: 'github',
      text: 'Repo: terraform modules',
      similarity: 0.41,
      criterionId: null,
    },
  ],
};

const grace: VacancyMatch = {
  candidate: makeCandidate({ id: 'c2', name: 'Grace Hopper', skills: [] }),
  score: 0.5,
  criteria: [],
  snippets: [],
};

function respondWith(matches: VacancyMatch[]) {
  const body: VacancyMatchesResponse = { mode: 'criteria', matches };
  server.use(
    http.get(`${baseUrl}/vacancies/v1/matches`, () => HttpResponse.json(body)),
  );
}

function renderDrawer(
  overrides: { open?: boolean; onAdded?: () => void } = {},
) {
  const onClose = vi.fn();
  const onAdded = overrides.onAdded ?? vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const ui = (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <MatchesDrawer
            vacancyId="v1"
            open={overrides.open ?? true}
            onClose={onClose}
            onAdded={onAdded}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
  return { ...render(ui), onClose, onAdded };
}

describe('MatchesDrawer', () => {
  it('shows the title, caption and a loading state', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, async () => {
        await new Promise(() => {});
        return HttpResponse.json({ mode: 'criteria', matches: [] });
      }),
    );
    renderDrawer();

    expect(
      screen.getByRole('heading', { name: 'Matches from the candidate pool' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ranked by how closely each candidate's CV and GitHub match the requirements. Added candidates are scored like applicants.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Finding matches…')).toBeInTheDocument();
  });

  it('does not request matches while closed', async () => {
    let calls = 0;
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, () => {
        calls += 1;
        return HttpResponse.json({ mode: 'criteria', matches: [] });
      }),
    );
    renderDrawer({ open: false });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toBe(0);
  });

  it('shows the API error message', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, () =>
        HttpResponse.json(
          { message: 'Matching is temporarily unavailable' },
          { status: 503 },
        ),
      ),
    );
    renderDrawer();

    expect(
      await screen.findByText(
        'Could not load matches: Matching is temporarily unavailable',
      ),
    ).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    respondWith([]);
    renderDrawer();

    expect(
      await screen.findByText('No pool candidates match this vacancy yet.'),
    ).toBeInTheDocument();
  });

  it('renders a card per match with criteria, skills and snippets', async () => {
    respondWith([ada, grace]);
    renderDrawer();

    const list = await screen.findByRole('list', { name: 'Matches' });
    const [adaCard, graceCard] = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.tagName === 'LI' && item.closest('ul') === list);

    const adaView = within(adaCard);
    expect(adaView.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/candidates/c1',
    );
    expect(adaView.getByText('2 of 3 criteria')).toBeInTheDocument();

    // must marker, matched vs unmatched (accessible via hidden text + icon)
    const [mustChip, niceChip, unmatchedChip] = within(
      adaView.getByRole('list', { name: 'Criteria for Ada Lovelace' }),
    ).getAllByRole('listitem');
    expect(within(mustChip).getByText('(must)')).toBeInTheDocument();
    expect(mustChip).toHaveClass('MuiChip-colorSuccess');
    expect(within(mustChip).getByTestId('CheckIcon')).toBeInTheDocument();
    expect(within(mustChip).getByText(', matched')).toBeInTheDocument();

    expect(niceChip).toHaveTextContent('Writes Terraform');
    expect(within(niceChip).queryByText('(must)')).not.toBeInTheDocument();
    expect(niceChip).toHaveClass('MuiChip-colorSuccess');

    expect(unmatchedChip).toHaveTextContent('Knows Python');
    expect(unmatchedChip).not.toHaveClass('MuiChip-colorSuccess');
    expect(
      within(unmatchedChip).queryByTestId('CheckIcon'),
    ).not.toBeInTheDocument();
    expect(
      within(unmatchedChip).getByText(', not matched'),
    ).toBeInTheDocument();

    // up to 5 skills + overflow
    expect(adaView.getByText('kubernetes')).toBeInTheDocument();
    expect(adaView.queryByText('react')).not.toBeInTheDocument();
    expect(adaView.getByText('+2')).toBeInTheDocument();

    // snippet captions: criterion text when tagged, none for null criterion
    expect(
      adaView.getByText('Operated Kubernetes clusters'),
    ).toBeInTheDocument();
    expect(
      adaView.getByText('For: Runs Kubernetes in production'),
    ).toBeInTheDocument();
    expect(adaView.getAllByText(/^For:/)).toHaveLength(1);
    expect(adaView.getByText('Repo: terraform modules')).toBeInTheDocument();

    // whole_text style match: no criteria chip
    const graceView = within(graceCard);
    expect(graceView.getByText('Grace Hopper')).toBeInTheDocument();
    expect(graceView.queryByText(/criteria$/)).not.toBeInTheDocument();
  });

  it('adds a candidate, calls onAdded and drops the card after the refetch', async () => {
    let body: unknown;
    let matches = [ada, grace];
    server.use(
      http.get(`${baseUrl}/vacancies/v1/matches`, () =>
        HttpResponse.json({ mode: 'criteria', matches }),
      ),
      http.post(`${baseUrl}/vacancies/v1/applications`, async ({ request }) => {
        body = await request.json();
        matches = [grace];
        return HttpResponse.json({ id: 'a1' }, { status: 201 });
      }),
    );
    const { onAdded } = renderDrawer();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add Ada Lovelace' }),
    );

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('Ada Lovelace'));
    expect(body).toEqual({ candidateId: 'c1' });
    await waitFor(() =>
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  it('shows the 409 message inline on the card', async () => {
    respondWith([ada, grace]);
    server.use(
      http.post(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json(
          { message: 'Candidate is already on this vacancy' },
          { status: 409 },
        ),
      ),
    );
    const { onAdded } = renderDrawer();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add Ada Lovelace' }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Candidate is already on this vacancy');
    expect(
      within(alert.closest('li') as HTMLElement).getByText('Ada Lovelace'),
    ).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Add Ada Lovelace' }),
    ).toBeEnabled();
  });
});
