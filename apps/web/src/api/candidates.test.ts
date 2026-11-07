import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import {
  getCandidate,
  listCandidateApplications,
  listCandidates,
  searchCandidates,
} from './candidates';

const baseUrl = 'http://localhost:3000';

const candidate = {
  id: '1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: ['react', 'typescript'],
  experience: '5 years',
  projects: ['Analytical Engine'],
  summary: 'Great candidate',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('candidates api', () => {
  it('listCandidates gets /candidates', async () => {
    server.use(
      http.get(`${baseUrl}/candidates`, () => HttpResponse.json([candidate])),
    );
    const result = await listCandidates();
    expect(result).toEqual([candidate]);
  });

  it('getCandidate gets /candidates/:id', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/1`, () => HttpResponse.json(candidate)),
    );
    const result = await getCandidate('1');
    expect(result).toEqual(candidate);
  });

  it('listCandidateApplications gets /candidates/:id/applications', async () => {
    server.use(
      http.get(`${baseUrl}/candidates/a%2Fb/applications`, () =>
        HttpResponse.json([]),
      ),
    );
    const result = await listCandidateApplications('a/b');
    expect(result).toEqual([]);
  });

  it('searchCandidates posts the query to /candidates/search', async () => {
    let body: unknown;
    const results = [
      {
        candidate,
        similarity: 0.8,
        snippets: [{ source: 'cv', text: 'Kafka', similarity: 0.8 }],
      },
    ];
    server.use(
      http.post(`${baseUrl}/candidates/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(results);
      }),
    );
    const result = await searchCandidates('kafka');
    expect(body).toEqual({ query: 'kafka' });
    expect(result).toEqual(results);
  });
});
