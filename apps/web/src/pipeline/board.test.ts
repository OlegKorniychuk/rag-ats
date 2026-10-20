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
  cv: {
    id: 'cv1',
    filename: 'cv.pdf',
    sizeBytes: 1024,
    uploadedAt: '2024-01-01T00:00:00.000Z',
  },
  parseStatus: 'parsed' as const,
  github: null,
  parseError: null,
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
    score: {
      status: 'pending',
      error: null,
      waitingForParse: false,
      stale: false,
      result: null,
    },
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

  it('sorts by overall score descending, unscored last, ties by createdAt', () => {
    const scored = (
      overall: number,
    ): ApplicationWithCandidateResponse['score'] => ({
      status: 'scored',
      error: null,
      waitingForParse: false,
      stale: false,
      result: {
        overall,
        rationale: '',
        criteria: [],
        cvDocumentId: 'cv1',
        model: 'm',
        mode: 'full_text',
        scoredAt: '2024-01-01T00:00:00.000Z',
      },
    });
    const staleResult = (overall: number) => ({
      ...scored(overall),
      status: 'pending' as const,
      stale: true,
    });
    const apps = [
      makeApplication({
        id: 'unscored-new',
        createdAt: '2024-01-05T00:00:00.000Z',
      }),
      makeApplication({
        id: 'low',
        score: scored(40),
        createdAt: '2024-01-01T00:00:00.000Z',
      }),
      makeApplication({
        id: 'tie-late',
        score: scored(80),
        createdAt: '2024-01-04T00:00:00.000Z',
      }),
      makeApplication({
        id: 'stale-high',
        score: staleResult(90),
        createdAt: '2024-01-06T00:00:00.000Z',
      }),
      makeApplication({
        id: 'tie-early',
        score: scored(80),
        createdAt: '2024-01-02T00:00:00.000Z',
      }),
      makeApplication({
        id: 'unscored-old',
        createdAt: '2024-01-03T00:00:00.000Z',
      }),
    ];
    expect(groupByStage(apps).applied.map((a) => a.id)).toEqual([
      'stale-high',
      'tie-early',
      'tie-late',
      'low',
      'unscored-old',
      'unscored-new',
    ]);
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
