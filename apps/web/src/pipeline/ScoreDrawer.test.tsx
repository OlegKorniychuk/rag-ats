import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type {
  ApplicationScore,
  ApplicationWithCandidateResponse,
  CriterionScore,
  ScoreResult,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { theme } from '../theme';
import { ScoreDrawer } from './ScoreDrawer';

const baseUrl = 'http://localhost:3000';

const result: ScoreResult = {
  overall: 82,
  rationale: 'Strong backend profile with minor gaps.',
  criteria: [
    {
      criterionId: 'c-nice-high',
      criterion: 'Knows Docker',
      importance: 'nice',
      score: 90,
      reasoning: 'Uses Docker daily.',
      quotes: [],
      retrieved: null,
    },
    {
      criterionId: 'c-must-low',
      criterion: 'Five years of TypeScript',
      importance: 'must',
      score: 40,
      reasoning: 'Only three years shown.',
      quotes: [{ source: 'cv', text: 'TypeScript since 2021 <b>bold</b>' }],
      retrieved: null,
    },
    {
      criterionId: 'c-must-high',
      criterion: 'PostgreSQL experience',
      importance: 'must',
      score: 95,
      reasoning: 'Designed schemas.',
      quotes: [
        { source: 'cv', text: 'Designed PostgreSQL schemas' },
        { source: 'github', text: 'repo: pg-tools' },
      ],
      retrieved: null,
    },
  ],
  cvDocumentId: 'cv1',
  model: 'gpt-test',
  mode: 'full_text',
  scoredAt: '2024-03-10T00:00:00.000Z',
};

const makeScore = (overrides: Partial<ApplicationScore>): ApplicationScore => ({
  status: 'scored',
  error: null,
  waitingForParse: false,
  stale: false,
  result,
  ...overrides,
});

function makeApplication(
  score: ApplicationScore,
): ApplicationWithCandidateResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    candidateId: 'c1',
    stage: 'applied',
    source: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate: {
      id: 'c1',
      name: 'Ada Lovelace',
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
      parseStatus: 'parsed',
      github: null,
      parseError: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    score,
  };
}

function renderDrawer(score: ApplicationScore, onClose = () => undefined) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <ScoreDrawer
          vacancyId="v1"
          vacancyTitle="Backend Dev"
          application={makeApplication(score)}
          onClose={onClose}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date('2024-03-10T00:00:00.000Z'));

describe('ScoreDrawer', () => {
  it('shows header, overall score, rationale and footer', () => {
    renderDrawer(makeScore({}));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Fit for Backend Dev')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Overall score 82 of 100'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Strong backend profile with minor gaps.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Scored ${formattedDate} · gpt-test · Full text`),
    ).toBeInTheDocument();
  });

  it('labels the footer with the RAG mode', () => {
    renderDrawer(makeScore({ result: { ...result, mode: 'rag' } }));
    expect(
      screen.getByText(`Scored ${formattedDate} · gpt-test · RAG`),
    ).toBeInTheDocument();
  });

  it('lists criteria must-first then by score, with quotes and source chips', () => {
    renderDrawer(makeScore({}));
    const items = screen.getAllByRole('listitem');
    expect(
      items.map((item) => within(item).getAllByText(/./)[0].textContent),
    ).toEqual([
      'PostgreSQL experience',
      'Five years of TypeScript',
      'Knows Docker',
    ]);

    const first = items[0];
    expect(within(first).getByText('Must')).toBeInTheDocument();
    expect(within(first).getByText('Designed schemas.')).toBeInTheDocument();
    expect(
      within(first).getByText('Designed PostgreSQL schemas'),
    ).toBeInTheDocument();
    expect(within(first).getByText('repo: pg-tools')).toBeInTheDocument();
    expect(within(first).getByText('CV')).toBeInTheDocument();
    expect(within(first).getByText('GitHub')).toBeInTheDocument();
    expect(within(items[2]).getByText('Nice to have')).toBeInTheDocument();
  });

  it('renders quote text as plain text', () => {
    renderDrawer(makeScore({}));
    expect(
      screen.getByText('TypeScript since 2021 <b>bold</b>'),
    ).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
  });

  it('shows the error for a failed score', () => {
    renderDrawer(
      makeScore({ status: 'failed', error: 'LLM exploded', result: null }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('LLM exploded');
    expect(screen.getByRole('button', { name: 'Rescore' })).toBeEnabled();
  });

  it('shows the scoring state and disables Rescore', () => {
    renderDrawer(makeScore({ status: 'scoring', result: null }));
    expect(screen.getByText('Scoring in progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescore' })).toBeDisabled();
  });

  it('shows the waiting-for-parse state', () => {
    renderDrawer(
      makeScore({ status: 'pending', waitingForParse: true, result: null }),
    );
    expect(
      screen.getByText('Waiting for the CV to be parsed'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rescore' })).toBeDisabled();
  });

  it('shows the stale note with the previous result', () => {
    renderDrawer(makeScore({ status: 'pending', stale: true }));
    expect(
      screen.getByText(
        'Showing the previous score; a new one is being computed.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('Overall score 82 of 100'),
    ).toBeInTheDocument();
  });

  it('posts a rescore, disables the button in flight and refetches', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.post(`${baseUrl}/applications/a1/rescore`, async () => {
        calls += 1;
        await gate;
        return HttpResponse.json(
          makeScore({ status: 'pending', stale: true }),
          { status: 202 },
        );
      }),
    );
    renderDrawer(makeScore({}));

    await userEvent.click(screen.getByRole('button', { name: 'Rescore' }));

    await waitFor(() => expect(calls).toBe(1));
    expect(screen.getByRole('button', { name: 'Rescore' })).toBeDisabled();
    release?.();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Rescore' })).toBeEnabled(),
    );
  });

  it('shows the server message on a 409', async () => {
    server.use(
      http.post(`${baseUrl}/applications/a1/rescore`, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Scoring is already in progress' },
          { status: 409 },
        ),
      ),
    );
    renderDrawer(makeScore({}));

    await userEvent.click(screen.getByRole('button', { name: 'Rescore' }));

    expect(
      await screen.findByText('Scoring is already in progress'),
    ).toBeInTheDocument();
  });

  it('shows an error for other failures', async () => {
    server.use(
      http.post(`${baseUrl}/applications/a1/rescore`, () =>
        HttpResponse.error(),
      ),
    );
    renderDrawer(makeScore({}));

    await userEvent.click(screen.getByRole('button', { name: 'Rescore' }));

    expect(
      await screen.findByText('Could not reach the server'),
    ).toBeInTheDocument();
  });

  describe('retrieved evidence', () => {
    const ragResult: ScoreResult = {
      ...result,
      mode: 'rag',
      criteria: result.criteria.map((criterion) =>
        criterion.criterionId === 'c-must-high'
          ? {
              ...criterion,
              retrieved: [
                {
                  source: 'cv',
                  text: 'PostgreSQL schema design',
                  similarity: 0.874,
                },
                {
                  source: 'github',
                  text: 'repo: pg-tools readme',
                  similarity: 0.5,
                },
              ],
            }
          : { ...criterion, retrieved: [] },
      ),
    };

    it('shows a collapsed toggle only for criteria with retrieved chunks', () => {
      renderDrawer(makeScore({ result: ragResult }));
      const toggles = screen.getAllByRole('button', {
        name: /Evidence retrieved/,
      });
      expect(toggles).toHaveLength(1);
      expect(toggles[0]).toHaveTextContent('Evidence retrieved (2)');
      expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('PostgreSQL schema design')).not.toBeVisible();
    });

    it('expands and collapses the retrieved chunks with similarity chips', async () => {
      renderDrawer(makeScore({ result: ragResult }));
      const toggle = screen.getByRole('button', { name: /Evidence retrieved/ });

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAttribute(
        'aria-controls',
        screen.getByText('PostgreSQL schema design').closest('[id]')?.id,
      );
      expect(screen.getByText('PostgreSQL schema design')).toBeVisible();
      expect(screen.getByText('repo: pg-tools readme')).toBeVisible();
      expect(screen.getByText('87% similar')).toBeVisible();
      expect(screen.getByText('50% similar')).toBeVisible();
      expect(
        screen.getByText('Chunks this criterion was scored from'),
      ).toBeVisible();

      await userEvent.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('PostgreSQL schema design')).not.toBeVisible();
    });

    it('keeps expanded state per criterion', async () => {
      const both: ScoreResult = {
        ...ragResult,
        criteria: ragResult.criteria.map((criterion) => ({
          ...criterion,
          retrieved: [
            {
              source: 'cv',
              text: `chunk for ${criterion.criterionId}`,
              similarity: 0.7,
            },
          ],
        })),
      };
      renderDrawer(makeScore({ result: both }));
      const toggles = screen.getAllByRole('button', {
        name: /Evidence retrieved/,
      });
      await userEvent.click(toggles[0]);
      expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
      expect(toggles[1]).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders no toggle for full-text results or old results without retrieved', () => {
      const legacy = {
        ...result,
        criteria: result.criteria.map((criterion) => {
          const rest: Partial<CriterionScore> = { ...criterion };
          delete rest.retrieved;
          return rest;
        }),
      } as unknown as ScoreResult;
      const { unmount } = renderDrawer(makeScore({}));
      expect(
        screen.queryByRole('button', { name: /Evidence retrieved/ }),
      ).toBeNull();
      unmount();
      renderDrawer(makeScore({ result: legacy }));
      expect(screen.getByText('PostgreSQL experience')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Evidence retrieved/ }),
      ).toBeNull();
    });
  });
});
