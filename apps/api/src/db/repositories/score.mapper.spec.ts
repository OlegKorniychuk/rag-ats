import type { ScoreResult } from '@rag-ats/shared';
import {
  toApplicationScore,
  type ScoreContext,
  type ScoreRow,
} from './score.mapper.js';

const context: ScoreContext = {
  candidateParseStatus: 'parsed',
  candidateParsedCvDocumentId: 'cv-1',
  vacancyCriteriaHash: 'hash-1',
};

function makeResult(retrieved?: ScoreResult['criteria'][number]['retrieved']) {
  const criterion = {
    criterionId: 'c1',
    criterion: 'Node.js',
    importance: 'must' as const,
    score: 80,
    reasoning: 'Uses Node.js',
    quotes: [{ source: 'cv' as const, text: 'Node.js' }],
  };
  return {
    overall: 80,
    rationale: 'Good',
    criteria: [
      retrieved === undefined ? criterion : { ...criterion, retrieved },
    ],
    cvDocumentId: 'cv-1',
    model: 'm',
    mode: 'full_text',
    scoredAt: '2026-01-01T00:00:00.000Z',
  } as ScoreResult;
}

function rowWith(result: ScoreResult | null): ScoreRow {
  return {
    status: 'scored',
    error: null,
    result,
    cvDocumentId: 'cv-1',
    criteriaHash: 'hash-1',
  };
}

describe('toApplicationScore', () => {
  it('defaults a missing retrieved to null for results stored before RAG', () => {
    const score = toApplicationScore(rowWith(makeResult()), context);

    expect(score.result?.criteria[0].retrieved).toBeNull();
  });

  it('keeps stored retrieved chunks untouched', () => {
    const retrieved = [
      { source: 'cv' as const, text: 'Node.js', similarity: 0.5 },
    ];

    const score = toApplicationScore(rowWith(makeResult(retrieved)), context);

    expect(score.result?.criteria[0].retrieved).toEqual(retrieved);
  });

  it('keeps an explicit null and does not mutate the stored result', () => {
    const stored = makeResult();

    toApplicationScore(rowWith(stored), context);

    expect(stored.criteria[0]).not.toHaveProperty('retrieved');
    expect(
      toApplicationScore(rowWith(makeResult(null)), context).result?.criteria[0]
        .retrieved,
    ).toBeNull();
  });

  it('leaves a missing row or null result as it was', () => {
    expect(toApplicationScore(undefined, context).result).toBeNull();
    expect(toApplicationScore(rowWith(null), context).result).toBeNull();
  });
});
