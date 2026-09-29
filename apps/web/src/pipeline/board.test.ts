import { describe, expect, it } from 'vitest';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { groupByStage, resolveDrop, STAGES } from './board';

const candidate = {
  id: 'c1',
  name: 'Ada',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: [],
  experience: '',
  projects: [],
  summary: '',
  createdAt: '2024-01-01T00:00:00.000Z',
};

function makeApplication(
  overrides: Partial<ApplicationWithCandidateResponse>,
): ApplicationWithCandidateResponse {
  return {
    id: 'a1',
    vacancyId: 'v1',
    candidateId: 'c1',
    stage: 'applied',
    createdAt: '2024-01-01T00:00:00.000Z',
    candidate,
    ...overrides,
  };
}

describe('STAGES', () => {
  it('is ordered applied, screened, interview, rejected, hired', () => {
    expect(STAGES.map((s) => s.id)).toEqual([
      'applied',
      'screened',
      'interview',
      'rejected',
      'hired',
    ]);
    expect(STAGES.map((s) => s.label)).toEqual([
      'Applied',
      'Screened',
      'Interview',
      'Rejected',
      'Hired',
    ]);
  });
});

describe('groupByStage', () => {
  it('buckets applications by stage', () => {
    const applied = makeApplication({ id: 'a1', stage: 'applied' });
    const hired = makeApplication({ id: 'a2', stage: 'hired' });
    const result = groupByStage([applied, hired]);
    expect(result.applied).toEqual([applied]);
    expect(result.hired).toEqual([hired]);
  });

  it('includes every stage key with an empty array when unused', () => {
    const result = groupByStage([]);
    expect(Object.keys(result).sort()).toEqual(
      ['applied', 'hired', 'interview', 'rejected', 'screened'].sort(),
    );
    for (const stage of STAGES) {
      expect(result[stage.id]).toEqual([]);
    }
  });

  it('sorts each stage bucket by createdAt ascending', () => {
    const later = makeApplication({
      id: 'a2',
      stage: 'applied',
      createdAt: '2024-02-01T00:00:00.000Z',
    });
    const earlier = makeApplication({
      id: 'a1',
      stage: 'applied',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    const result = groupByStage([later, earlier]);
    expect(result.applied.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('does not mutate the input array', () => {
    const later = makeApplication({
      id: 'a2',
      stage: 'applied',
      createdAt: '2024-02-01T00:00:00.000Z',
    });
    const earlier = makeApplication({
      id: 'a1',
      stage: 'applied',
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    const input = [later, earlier];
    groupByStage(input);
    expect(input).toEqual([later, earlier]);
  });
});

describe('resolveDrop', () => {
  const applications = [
    makeApplication({ id: 'a1', stage: 'applied' }),
    makeApplication({ id: 'a2', stage: 'screened' }),
  ];

  it('returns null when overId is null', () => {
    expect(resolveDrop('a1', null, applications)).toBeNull();
  });

  it('returns null when overId is not a known stage id', () => {
    expect(resolveDrop('a1', 'not-a-stage', applications)).toBeNull();
  });

  it('returns null when the active application is not found', () => {
    expect(resolveDrop('unknown', 'screened', applications)).toBeNull();
  });

  it('returns null when the target stage equals the current stage', () => {
    expect(resolveDrop('a1', 'applied', applications)).toBeNull();
  });

  it('returns the move when the drop is valid', () => {
    expect(resolveDrop('a1', 'screened', applications)).toEqual({
      id: 'a1',
      stage: 'screened',
    });
  });
});
