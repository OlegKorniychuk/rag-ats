import { describe, expect, it } from 'vitest';
import type { CandidateResponse } from '@rag-ats/shared';
import { filterCandidates } from './filter';

function makeCandidate(
  overrides: Partial<CandidateResponse>,
): CandidateResponse {
  return {
    id: '1',
    name: 'Marie Curie',
    email: 'marie@example.com',
    githubUrl: null,
    portfolioUrl: null,
    skills: ['react', 'python'],
    experience: '5 years',
    projects: [],
    summary: '',
    cv: {
      id: 'cv1',
      filename: 'cv.pdf',
      sizeBytes: 1024,
      uploadedAt: '2024-01-01T00:00:00.000Z',
    },
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterCandidates', () => {
  const candidates = [
    makeCandidate({ id: '1' }),
    makeCandidate({
      id: '2',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      skills: ['react', 'ada'],
    }),
  ];

  it('returns all candidates for an empty query', () => {
    expect(filterCandidates(candidates, '')).toEqual(candidates);
  });

  it('returns all candidates for a whitespace-only query', () => {
    expect(filterCandidates(candidates, '   ')).toEqual(candidates);
  });

  it('matches case-insensitively by name', () => {
    const result = filterCandidates(candidates, 'MARIE CURIE');
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('matches by email', () => {
    const result = filterCandidates(candidates, 'grace@example.com');
    expect(result.map((c) => c.id)).toEqual(['2']);
  });

  it('matches by skill', () => {
    const result = filterCandidates(candidates, 'python');
    expect(result.map((c) => c.id)).toEqual(['1']);
  });

  it('requires every term to match (AND) across fields', () => {
    const result = filterCandidates(candidates, 'react ada');
    expect(result.map((c) => c.id)).toEqual(['2']);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterCandidates(candidates, 'nonexistent')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const original = [...candidates];
    filterCandidates(candidates, 'grace');
    expect(candidates).toEqual(original);
  });
});
