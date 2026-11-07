import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CandidateResponse, CandidateSearchResult } from '@rag-ats/shared';
import { server } from '../test/server';
import { renderApp } from '../test/render';

const baseUrl = 'http://localhost:3000';
const session = {
  status: 'authenticated' as const,
  user: { id: 'u1', email: 'r@example.com' },
};

const candidate: CandidateResponse = {
  id: '1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: ['kafka', 'kubernetes', 'go', 'rust', 'sql', 'react', 'node'],
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
};

const longSnippet = 'Operated large Kafka clusters. '.repeat(15);

function respondWith(results: CandidateSearchResult[]) {
  server.use(
    http.post(`${baseUrl}/candidates/search`, () => HttpResponse.json(results)),
  );
}

describe('CandidateSearchResults', () => {
  it('shows one list item per result with skills and snippets', async () => {
    respondWith([
      {
        candidate,
        similarity: 0.5,
        snippets: [
          { source: 'cv', text: 'Short CV line', similarity: 0.5 },
          { source: 'github', text: 'Repo: streaming', similarity: 0.4 },
        ],
      },
    ]);
    renderApp({ route: '/candidates?q=kafka', session });

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    const item = within(items[0]);
    expect(item.getByText('50% match')).toBeInTheDocument();
    expect(item.getByText('kafka')).toBeInTheDocument();
    expect(item.queryByText('react')).not.toBeInTheDocument();
    expect(item.getByText('+2')).toBeInTheDocument();
    expect(item.getByText('Short CV line')).toBeInTheDocument();
    expect(item.getByText('GitHub')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Only candidates whose CV has been processed appear in search.',
      ),
    ).toBeInTheDocument();
  });

  it('clamps long snippets behind a Show more toggle', async () => {
    respondWith([
      {
        candidate,
        similarity: 0.9,
        snippets: [{ source: 'cv', text: longSnippet, similarity: 0.9 }],
      },
    ]);
    renderApp({ route: '/candidates?q=kafka', session });

    const toggle = await screen.findByRole('button', { name: 'Show more' });
    await userEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Show less' }),
    ).toBeInTheDocument();
  });
});
