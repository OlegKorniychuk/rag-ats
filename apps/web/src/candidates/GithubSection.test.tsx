import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GithubSummary } from '@rag-ats/shared';
import { GithubSection } from './GithubSection';

function makeGithub(overrides: Partial<GithubSummary> = {}): GithubSummary {
  return {
    username: 'ada',
    profileUrl: 'https://github.com/ada',
    status: 'ok',
    fetchedAt: '2024-02-01T00:00:00.000Z',
    languages: [
      { name: 'TypeScript', repoCount: 4 },
      { name: 'Rust', repoCount: 1 },
    ],
    repos: [
      {
        name: 'engine',
        url: 'https://github.com/ada/engine',
        description: 'Analytical engine emulator',
        language: 'TypeScript',
        stars: 42,
        topics: ['math'],
        pushedAt: '2024-01-20T00:00:00.000Z',
      },
      {
        name: 'notes',
        url: 'https://github.com/ada/notes',
        description: null,
        language: null,
        stars: 0,
        topics: [],
        pushedAt: '2023-06-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

function formatted(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(iso),
  );
}

describe('GithubSection', () => {
  it('renders nothing when github is null', () => {
    const { container } = render(<GithubSection github={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the heading and a profile link opening in a new tab', () => {
    render(<GithubSection github={makeGithub()} />);

    const section = screen.getByRole('region', { name: 'GitHub' });
    expect(
      within(section).getByRole('heading', { name: 'GitHub' }),
    ).toBeInTheDocument();
    const profile = within(section).getByRole('link', { name: '@ada' });
    expect(profile).toHaveAttribute('href', 'https://github.com/ada');
    expect(profile).toHaveAttribute('target', '_blank');
    expect(profile).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders language chips with repo counts', () => {
    render(<GithubSection github={makeGithub()} />);

    expect(screen.getByText('TypeScript · 4')).toBeInTheDocument();
    expect(screen.getByText('Rust · 1')).toBeInTheDocument();
  });

  it('renders repos with link, description, language, stars and date', () => {
    render(<GithubSection github={makeGithub()} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);

    const link = within(items[0]).getByRole('link', { name: 'engine' });
    expect(link).toHaveAttribute('href', 'https://github.com/ada/engine');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(
      within(items[0]).getByText('Analytical engine emulator'),
    ).toBeInTheDocument();
    expect(
      within(items[0]).getByText(
        `TypeScript · ★ 42 · pushed ${formatted('2024-01-20T00:00:00.000Z')}`,
      ),
    ).toBeInTheDocument();

    expect(
      within(items[1]).getByText(
        `★ 0 · pushed ${formatted('2023-06-01T00:00:00.000Z')}`,
      ),
    ).toBeInTheDocument();
  });

  it('shows a message when there are no public repositories', () => {
    render(<GithubSection github={makeGithub({ repos: [], languages: [] })} />);

    expect(screen.getByText('No public repositories')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders unsafe URLs as plain text instead of links', () => {
    render(
      <GithubSection
        github={makeGithub({
          profileUrl: 'javascript:alert(1)',
          repos: [
            {
              name: 'evil',
              url: 'javascript:alert(2)',
              description: null,
              language: null,
              stars: 1,
              topics: [],
              pushedAt: '2024-01-20T00:00:00.000Z',
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('@ada')).toBeInTheDocument();
    expect(screen.getByText('evil')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an info alert when the profile was not found', () => {
    render(
      <GithubSection
        github={makeGithub({ status: 'not_found', repos: [], languages: [] })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'GitHub data unavailable (profile not found) — the profile was parsed from the CV only.',
    );
    expect(
      screen.queryByText('No public repositories'),
    ).not.toBeInTheDocument();
  });

  it('shows an info alert when GitHub could not be reached', () => {
    render(
      <GithubSection
        github={makeGithub({ status: 'unavailable', repos: [], languages: [] })}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'GitHub data unavailable (GitHub could not be reached) — the profile was parsed from the CV only.',
    );
  });
});
