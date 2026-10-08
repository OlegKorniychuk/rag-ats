import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateResponse } from '@rag-ats/shared';
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
    createdAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date('2024-01-15T00:00:00.000Z'));

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

  it('narrows rows when typing in the filter and updates the URL', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([
          makeCandidate({ id: '1', name: 'Ada Lovelace' }),
          makeCandidate({
            id: '2',
            name: 'Grace Hopper',
            email: 'grace@example.com',
          }),
        ]),
      ),
    );
    const { router } = renderApp({ route: '/candidates', session });

    await screen.findByText('Ada Lovelace');
    await userEvent.type(
      screen.getByLabelText('Filter by name, email or skill'),
      'grace',
    );

    await waitFor(() =>
      expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?q=grace');
  });

  it('shows a no-match message when the filter matches nothing', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([makeCandidate({})]),
      ),
    );
    renderApp({ route: '/candidates', session });

    await screen.findByText('Ada Lovelace');
    await userEvent.type(
      screen.getByLabelText('Filter by name, email or skill'),
      'nonexistent',
    );

    expect(
      await screen.findByText('No candidates match "nonexistent"'),
    ).toBeInTheDocument();
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

  it('pre-fills the filter and shows filtered rows from ?q=', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([
          makeCandidate({ id: '1', name: 'Ada Lovelace', skills: ['react'] }),
          makeCandidate({
            id: '2',
            name: 'Grace Hopper',
            email: 'grace@example.com',
            skills: ['python'],
          }),
        ]),
      ),
    );
    renderApp({ route: '/candidates?q=react', session });

    expect(screen.getByLabelText('Filter by name, email or skill')).toHaveValue(
      'react',
    );
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
  });

  it('shows the candidate count', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () =>
        HttpResponse.json([
          makeCandidate({ id: '1', name: 'Ada Lovelace' }),
          makeCandidate({
            id: '2',
            name: 'Grace Hopper',
            email: 'grace@example.com',
          }),
        ]),
      ),
    );
    renderApp({ route: '/candidates', session });

    expect(await screen.findByText('2 candidates')).toBeInTheDocument();

    await userEvent.type(
      screen.getByLabelText('Filter by name, email or skill'),
      'grace',
    );
    expect(await screen.findByText('1 of 2')).toBeInTheDocument();
  });
});
