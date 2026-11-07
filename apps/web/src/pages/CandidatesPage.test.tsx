import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateResponse, CandidateSearchResult } from '@rag-ats/shared';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};

function makeCandidate(
  overrides: Partial<CandidateResponse>,
): CandidateResponse {
  return {
    id: '1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    githubUrl: null,
    portfolioUrl: null,
    skills: ['react', 'typescript'],
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

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date('2024-01-15T00:00:00.000Z'));

const searchLabel = 'Search candidates';

function makeResult(
  overrides: Partial<CandidateSearchResult> = {},
): CandidateSearchResult {
  return {
    candidate: makeCandidate({}),
    similarity: 0.874,
    snippets: [
      {
        source: 'cv',
        text: 'Ran Kafka clusters on Kubernetes',
        similarity: 0.874,
      },
    ],
    ...overrides,
  };
}

function useSearch(
  results: CandidateSearchResult[],
  onBody?: (body: unknown) => void,
) {
  server.use(
    http.post(`${baseUrl}/candidates/search`, async ({ request }) => {
      onBody?.(await request.json());
      return HttpResponse.json(results);
    }),
  );
}

describe('CandidatesPage', () => {
  it('renders candidate rows from the list', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([makeCandidate({})]),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText(formattedDate)).toBeInTheDocument();
  });

  it('shows 5 skill chips and a +N chip for 7 skills', async () => {
    const candidate = makeCandidate({
      skills: [
        'react',
        'typescript',
        'node',
        'graphql',
        'python',
        'go',
        'rust',
      ],
    });
    server.use(
      http.get(`${baseUrl}/candidates`, () => HttpResponse.json([candidate])),
    );
    renderApp({ route: '/candidates', session });

    await screen.findByText('Ada Lovelace');
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
    expect(screen.getByText('node')).toBeInTheDocument();
    expect(screen.getByText('graphql')).toBeInTheDocument();
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.queryByText('go')).not.toBeInTheDocument();
    expect(screen.queryByText('rust')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('shows an empty state when there are no candidates', async () => {
    server.use(http.get(`${baseUrl}/candidates`, () => HttpResponse.json([])));
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('No candidates yet')).toBeInTheDocument();
  });

  it('shows an error alert on a failed load', async () => {
    server.use(
      http.get(
        `${baseUrl}/candidates`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(
      await screen.findByText(/Could not load candidates/),
    ).toBeInTheDocument();
  });

  it('navigates to the candidate page when the name is clicked', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([makeCandidate({ id: '42' })]),
      ),
    );
    const { router } = renderApp({ route: '/candidates', session });

    await screen.findByText('Ada Lovelace');
    await userEvent.click(screen.getByRole('link', { name: 'Ada Lovelace' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/candidates/42'),
    );
  });

  it('shows a status chip for unparsed candidates only', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([
          makeCandidate({ id: '1', name: 'Ada', parseStatus: 'pending' }),
          makeCandidate({ id: '2', name: 'Bob', parseStatus: 'failed' }),
          makeCandidate({ id: '3', name: 'Cy', parseStatus: 'parsed' }),
        ]),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Parsed')).not.toBeInTheDocument();
  });

  it('renders a candidate with no skills', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([makeCandidate({ skills: [] })]),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('shows the candidate count', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([
          makeCandidate({ id: '1', name: 'Ada Lovelace' }),
          makeCandidate({ id: '2', name: 'Grace Hopper' }),
        ]),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('2 candidates')).toBeInTheDocument();
  });

  describe('semantic search', () => {
    it('searches on Enter, updates ?q= and shows results', async () => {
      server.use(
        http.get(`${baseUrl}/candidates`, () =>
          HttpResponse.json([makeCandidate({})]),
        ),
      );
      let body: unknown;
      useSearch([makeResult()], (value) => (body = value));
      const { router } = renderApp({ route: '/candidates', session });

      await screen.findByText('Ada Lovelace');
      await userEvent.type(
        screen.getByLabelText(searchLabel),
        '  kafka engineer {Enter}',
      );

      const results = await screen.findByRole('list', {
        name: 'Search results',
      });
      expect(
        within(results).getByRole('link', { name: 'Ada Lovelace' }),
      ).toBeInTheDocument();
      expect(within(results).getByText('87% match')).toBeInTheDocument();
      expect(
        within(results).getByText('Ran Kafka clusters on Kubernetes'),
      ).toBeInTheDocument();
      expect(within(results).getByText('CV')).toBeInTheDocument();
      expect(body).toEqual({ query: 'kafka engineer' });
      expect(router.state.location.search).toBe('?q=kafka+engineer');
      // the list is replaced by results
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('does not search while typing', async () => {
      server.use(
        http.get(`${baseUrl}/candidates`, () =>
          HttpResponse.json([makeCandidate({})]),
        ),
      );
      const { router } = renderApp({ route: '/candidates', session });

      await screen.findByText('Ada Lovelace');
      await userEvent.type(screen.getByLabelText(searchLabel), 'kafka');

      // an unhandled POST /candidates/search would error the test
      expect(router.state.location.search).toBe('');
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('does not request a search without ?q=', async () => {
      server.use(
        http.get(`${baseUrl}/candidates`, () =>
          HttpResponse.json([makeCandidate({})]),
        ),
      );
      renderApp({ route: '/candidates', session });

      expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
      expect(screen.getByLabelText(searchLabel)).toHaveValue('');
    });

    it('pre-fills the input and runs the search from ?q=', async () => {
      let body: unknown;
      useSearch([makeResult()], (value) => (body = value));
      renderApp({ route: '/candidates?q=kafka', session });

      expect(screen.getByLabelText(searchLabel)).toHaveValue('kafka');
      expect(await screen.findByText('87% match')).toBeInTheDocument();
      expect(body).toEqual({ query: 'kafka' });
    });

    it('shows a no-results message', async () => {
      useSearch([]);
      renderApp({ route: '/candidates?q=cobol', session });

      expect(
        await screen.findByText('No candidates match "cobol"'),
      ).toBeInTheDocument();
    });

    it('shows an error alert when search is unavailable', async () => {
      server.use(
        http.post(`${baseUrl}/candidates/search`, () =>
          HttpResponse.json(
            { statusCode: 503, message: 'Search is temporarily unavailable' },
            { status: 503 },
          ),
        ),
      );
      renderApp({ route: '/candidates?q=kafka', session });

      expect(
        await screen.findByText(
          /Could not load search results: Search is temporarily unavailable/,
        ),
      ).toBeInTheDocument();
    });

    it('returns to the list and clears ?q= on Escape', async () => {
      server.use(
        http.get(`${baseUrl}/candidates`, () =>
          HttpResponse.json([makeCandidate({})]),
        ),
      );
      useSearch([makeResult()]);
      const { router } = renderApp({ route: '/candidates?q=kafka', session });

      await screen.findByText('87% match');
      await userEvent.type(screen.getByLabelText(searchLabel), '{Escape}');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(screen.getByLabelText(searchLabel)).toHaveValue('');
      expect(router.state.location.search).toBe('');
    });

    it('returns to the list when Enter is pressed on an empty input', async () => {
      server.use(
        http.get(`${baseUrl}/candidates`, () =>
          HttpResponse.json([makeCandidate({})]),
        ),
      );
      useSearch([makeResult()]);
      const { router } = renderApp({ route: '/candidates?q=kafka', session });

      await screen.findByText('87% match');
      const input = screen.getByLabelText(searchLabel);
      await userEvent.clear(input);
      expect(router.state.location.search).toBe('?q=kafka');
      await userEvent.type(input, '   {Enter}');

      expect(await screen.findByRole('table')).toBeInTheDocument();
      expect(router.state.location.search).toBe('');
    });

    it('uses singular and plural result headers', async () => {
      useSearch([makeResult()]);
      const { unmount } = renderApp({ route: '/candidates?q=kafka', session });
      expect(await screen.findByText(/^1 match for/)).toBeInTheDocument();
      unmount();

      useSearch([
        makeResult(),
        makeResult({ candidate: makeCandidate({ id: '2', name: 'Grace' }) }),
      ]);
      renderApp({ route: '/candidates?q=kafka', session });
      expect(await screen.findByText(/^2 matches for/)).toBeInTheDocument();
    });

    it('links a result to the candidate page', async () => {
      useSearch([makeResult({ candidate: makeCandidate({ id: '42' }) })]);
      const { router } = renderApp({ route: '/candidates?q=kafka', session });

      await userEvent.click(
        await screen.findByRole('link', { name: 'Ada Lovelace' }),
      );

      await waitFor(() =>
        expect(router.state.location.pathname).toBe('/candidates/42'),
      );
    });
  });
});
