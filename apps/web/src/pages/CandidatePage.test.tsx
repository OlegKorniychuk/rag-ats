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
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    githubUrl: 'https://github.com/ada',
    portfolioUrl: 'https://ada.dev',
    skills: ['TypeScript', 'React'],
    experience: 'Line one\nLine two',
    projects: ['Analytical Engine', 'Notes on the Engine'],
    summary: 'A pioneering programmer.',
    createdAt: '2024-01-15T00:00:00.000Z',
    ...overrides,
  };
}

const formattedDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
}).format(new Date('2024-01-15T00:00:00.000Z'));

describe('CandidatePage', () => {
  it('renders all candidate fields', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({})),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    expect(
      await screen.findByRole('heading', { name: 'Ada Lovelace' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText(`Added ${formattedDate}`)).toBeInTheDocument();
    expect(screen.getByText('A pioneering programmer.')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Analytical Engine')).toBeInTheDocument();
    expect(screen.getByText('Notes on the Engine')).toBeInTheDocument();
  });

  it('preserves newlines in the experience text', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({ experience: 'Line one\nLine two' })),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    const experienceText = screen.getByText(
      (_, element) => element?.textContent === 'Line one\nLine two',
    );
    expect(experienceText).toBeInTheDocument();
  });

  it('shows "No projects listed" when there are no projects', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({ projects: [] })),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    expect(await screen.findByText('No projects listed')).toBeInTheDocument();
  });

  it('shows "No skills listed" when there are no skills', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({ skills: [] })),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    expect(await screen.findByText('No skills listed')).toBeInTheDocument();
  });

  it('does not render GitHub or Portfolio links when null', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(
          makeCandidate({ githubUrl: null, portfolioUrl: null }),
        ),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(
      screen.queryByRole('link', { name: 'GitHub' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Portfolio' }),
    ).not.toBeInTheDocument();
  });

  it('renders external links with target=_blank and rel containing noopener', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({})),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    const githubLink = await screen.findByRole('link', { name: 'GitHub' });
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink.getAttribute('rel')).toContain('noopener');
    expect(githubLink).toHaveAttribute('href', 'https://github.com/ada');

    const portfolioLink = screen.getByRole('link', { name: 'Portfolio' });
    expect(portfolioLink).toHaveAttribute('target', '_blank');
    expect(portfolioLink.getAttribute('rel')).toContain('noopener');
  });

  it('renders unsafe URLs as plain text instead of a link', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({ githubUrl: 'javascript:alert(1)' })),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    expect(
      screen.queryByRole('link', { name: 'GitHub' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('javascript:alert(1)')).toBeInTheDocument();
  });

  it('renders the email as a mailto link', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({})),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    const emailLink = await screen.findByRole('link', {
      name: 'ada@example.com',
    });
    expect(emailLink).toHaveAttribute('href', 'mailto:ada@example.com');
  });

  it('shows "Candidate not found" for a 404 with a working back link', async () => {
    server.use(
      http.get(
        `${baseUrl}/candidates/c1`,
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(`${baseUrl}/candidates`, () => HttpResponse.json([])),
    );
    renderApp({ route: '/candidates/c1', session });

    expect(await screen.findByText('Candidate not found')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '← Candidates' }),
    ).toBeInTheDocument();
  });

  it('shows an error alert on a 500', async () => {
    server.use(
      http.get(
        `${baseUrl}/candidates/c1`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    renderApp({ route: '/candidates/c1', session });

    expect(
      await screen.findByText(/Could not load this candidate/),
    ).toBeInTheDocument();
  });

  it('navigates to /candidates when the back link is clicked', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/c1`, () =>
        HttpResponse.json(makeCandidate({})),
      ),
      http.get(`${baseUrl}/candidates`, () => HttpResponse.json([])),
    );
    const { router } = renderApp({ route: '/candidates/c1', session });

    await screen.findByRole('heading', { name: 'Ada Lovelace' });
    await userEvent.click(screen.getByRole('link', { name: '← Candidates' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/candidates'),
    );
  });
});
