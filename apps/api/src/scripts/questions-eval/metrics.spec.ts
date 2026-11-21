import { threeRecords } from './test-fixture.js';
import { computeQuestionsMetrics } from './metrics.js';

const pricing = { inputPerMillion: 1, outputPerMillion: 4 };

describe('computeQuestionsMetrics', () => {
  it('computes exact numbers for a hand-made 3-record fixture', () => {
    expect(computeQuestionsMetrics(threeRecords(), pricing)).toEqual({
      applications: 3,
      ok: 2,
      retried: 1,
      failed: 1,
      questionsPerApp: { mean: 3, min: 3, max: 3 },
      basisByBand: {
        strong: { fact: 2, gap: 1 },
        partial: { fact: 0, gap: 0 },
        weak: { fact: 1, gap: 2 },
      },
      // gaps: a1 c3 (20), a2 c2 (60), a2 c3 (0) -> 2 of 3 below 50
      gapOnLowCriterion: 2 / 3,
      // facts: a1 c1 (cited), a1 c2 (not), a2 c1 (cited) -> 2 of 3
      factCitesScoreUnit: 2 / 3,
      // 1M input at $1 + 1M output at $4
      costUsd: 5,
    });
  });

  it('reports null shares and zero counts without questions', () => {
    const metrics = computeQuestionsMetrics([threeRecords()[2]], pricing);
    expect(metrics).toMatchObject({
      applications: 1,
      ok: 0,
      failed: 1,
      questionsPerApp: { mean: 0, min: 0, max: 0 },
      gapOnLowCriterion: null,
      factCitesScoreUnit: null,
      costUsd: 0,
    });
  });
});
