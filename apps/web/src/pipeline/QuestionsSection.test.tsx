import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import type {
  ApplicationQuestions,
  ApplicationScore,
  QuestionSet,
} from '@rag-ats/shared';
import { server } from '../test/server';
import { theme } from '../theme';
import { QuestionsSection } from './QuestionsSection';

vi.mock('./score', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./score')>()),
  SCORE_POLL_INTERVAL_MS: 50,
}));

const baseUrl = 'http://localhost:3000';
const url = `${baseUrl}/applications/a1/questions`;

const score: ApplicationScore = {
  status: 'scored',
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
};

const set: QuestionSet = {
  questions: [
    {
      text: 'You led the Kafka migration. What broke first?',
      basis: 'fact',
      criterionId: 'c1',
      criterion: 'Event-driven backend',
      importance: 'must',
      purpose: 'hands-on Kafka depth.',
      quotes: [{ source: 'cv', text: 'Led the Kafka migration <b>x</b>' }],
    },
    {
      text: 'How would you move Compose to Kubernetes?',
      basis: 'gap',
      criterionId: 'c2',
      criterion: 'Kubernetes in production',
      importance: 'nice',
      purpose: 'orchestration knowledge.',
      quotes: [],
    },
  ],
  cvDocumentId: 'cv1',
  model: 'gpt-test',
  generatedAt: '2024-03-10T00:00:00.000Z',
};

const state = (
  overrides: Partial<ApplicationQuestions>,
): ApplicationQuestions => ({
  status: null,
  error: null,
  stale: false,
  result: null,
  ...overrides,
});

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date('2024-03-10T00:00:00.000Z'));

function respond(body: ApplicationQuestions) {
  server.use(http.get(url, () => HttpResponse.json(body)));
}

function renderSection(scoreOverride: Partial<ApplicationScore> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <QuestionsSection
          applicationId="a1"
          score={{ ...score, ...scoreOverride }}
        />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('QuestionsSection', () => {
  it('shows the generate button when never requested', async () => {
    renderSection();

    expect(
      screen.getByRole('heading', { name: 'Interview questions' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Generate questions' }),
      ).toBeEnabled(),
    );
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('disables the button with a tooltip when the score is not scored or stale', async () => {
    const { unmount } = renderSection({ status: 'scoring' });
    const button = await screen.findByRole('button', {
      name: 'Generate questions',
    });
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement!);
    expect(
      await screen.findByRole('tooltip', {
        name: 'Score the application first',
      }),
    ).toBeInTheDocument();
    unmount();

    renderSection({ stale: true });
    expect(
      await screen.findByRole('button', { name: 'Generate questions' }),
    ).toBeDisabled();
  });

  it('shows progress and polls while generating, then stops when ready', async () => {
    let calls = 0;
    server.use(
      http.get(url, () => {
        calls += 1;
        return HttpResponse.json(
          calls === 1
            ? state({ status: 'generating' })
            : state({ status: 'ready', result: set }),
        );
      }),
    );
    renderSection();

    expect(
      await screen.findByText('Generating questions…'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('You led the Kafka migration. What broke first?'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Generating questions…')).not.toBeInTheDocument();

    const settled = calls;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls).toBe(settled);
  });

  it('groups gap questions before fact questions with chips, purpose and quotes', async () => {
    respond(state({ status: 'ready', result: set }));
    renderSection();

    const gaps = await screen.findByRole('list', { name: 'Gaps to probe' });
    const facts = screen.getByRole('list', { name: 'Facts to verify' });
    expect(
      gaps.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(gaps).getByText('GAP')).toBeInTheDocument();
    expect(within(gaps).getByText('Nice to have')).toBeInTheDocument();
    expect(
      within(gaps).getByText('Kubernetes in production'),
    ).toBeInTheDocument();
    expect(
      within(gaps).getByText('Checks: orchestration knowledge.'),
    ).toBeInTheDocument();

    expect(within(facts).getByText('FACT')).toBeInTheDocument();
    expect(within(facts).getByText('Must')).toBeInTheDocument();
    expect(
      within(facts).getByText('Led the Kafka migration <b>x</b>'),
    ).toBeInTheDocument();
    expect(within(facts).getByText('CV')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();

    expect(
      screen.getByText(`Generated ${formattedDate} · gpt-test`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  });

  it('shows the error with Retry when failed', async () => {
    respond(state({ status: 'failed', error: 'Could not generate questions' }));
    renderSection();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not generate questions',
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it('shows the previous set greyed with the outdated note when stale', async () => {
    respond(state({ status: 'ready', stale: true, result: set }));
    renderSection();

    expect(
      await screen.findByText(
        'Outdated: the CV, requirements or score changed',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('questions-result')).toHaveStyle({
      opacity: '0.6',
    });
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled();
  });

  it('Regenerate posts and shows progress', async () => {
    let posted = false;
    let generating = false;
    server.use(
      http.get(url, () =>
        HttpResponse.json(
          generating
            ? state({ status: 'generating', stale: true, result: set })
            : state({ status: 'ready', result: set }),
        ),
      ),
      http.post(url, () => {
        posted = true;
        generating = true;
        return HttpResponse.json(
          state({ status: 'pending', stale: true, result: set }),
          { status: 202 },
        );
      }),
    );
    renderSection();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Regenerate' }),
    );

    expect(
      await screen.findByText('Generating questions…'),
    ).toBeInTheDocument();
    expect(posted).toBe(true);
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled();
  });

  it('a 409 shows the server message inline', async () => {
    server.use(
      http.post(url, () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Score the application first' },
          { status: 409 },
        ),
      ),
    );
    renderSection();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Generate questions' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Score the application first',
      ),
    );
  });
});
