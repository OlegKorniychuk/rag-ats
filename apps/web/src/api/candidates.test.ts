import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { getCandidate, listCandidates } from './candidates';

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
});
