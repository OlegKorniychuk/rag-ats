import { bandOf } from '../synth/ground-truth.js';
import { cohenKappa, confusionMatrix } from '../synth/spot-check.js';
import type { Band } from '../synth/types.js';
import {
  averageRanks,
  bandKappas,
  bootstrapCi,
  bootstrapDifference,
  kappaOf,
  mae,
  maeOf,
  mean,
  meanBy,
  meanSignedError,
  ndcgAtK,
  perBandMae,
  precisionAtK,
  quantile,
  recallAtK,
  reciprocalRank,
  scorerBandPairs,
  spearman,
  spearmanOf,
  weightedBandAgreement,
  weightedMae,
  type AgreementRow,
} from './metrics.js';

const gains = (entries: Record<string, number>) =>
  new Map(Object.entries(entries));

// Relevant: a (1), e (1), x (1, never retrieved), c (0.5).
const GAINS = gains({ a: 1, c: 0.5, e: 1, x: 1 });
const RANKED = ['a', 'b', 'c', 'd', 'e'];

describe('retrieval metrics', () => {
  it('computes precision@k, counting a partial hit as a hit', () => {
    expect(precisionAtK(RANKED, GAINS, 3)).toBeCloseTo(2 / 3);
    expect(precisionAtK(RANKED, GAINS, 5)).toBeCloseTo(3 / 5);
  });

  it('divides by k even when fewer than k results came back', () => {
    expect(precisionAtK(['a'], GAINS, 5)).toBeCloseTo(1 / 5);
  });

  it('computes recall@k over every item with a gain above 0', () => {
    expect(recallAtK(RANKED, GAINS, 3)).toBeCloseTo(2 / 4);
    expect(recallAtK(RANKED, GAINS, 5)).toBeCloseTo(3 / 4);
    expect(recallAtK(RANKED, GAINS, 1)).toBeCloseTo(1 / 4);
  });

  it('counts a repeated id once', () => {
    expect(precisionAtK(['a', 'a', 'a'], GAINS, 3)).toBeCloseTo(1 / 3);
    expect(recallAtK(['a', 'a', 'a'], GAINS, 3)).toBeCloseTo(1 / 4);
  });

  it('computes graded nDCG@k with a log2 discount', () => {
    // DCG@5 = 1/log2(2) + 0.5/log2(4) + 1/log2(6); ideal gains 1, 1, 1, 0.5.
    const dcg = 1 + 0.5 / 2 + 1 / Math.log2(6);
    const ideal = 1 + 1 / Math.log2(3) + 1 / 2 + 0.5 / Math.log2(5);
    expect(ndcgAtK(RANKED, GAINS, 5)).toBeCloseTo(dcg / ideal, 10);
  });

  it('truncates the ideal ordering at k', () => {
    // @2: ranked a, b -> DCG 1; ideal = two gain-1 items = 1 + 1/log2(3).
    expect(ndcgAtK(RANKED, GAINS, 2)).toBeCloseTo(
      1 / (1 + 1 / Math.log2(3)),
      10,
    );
  });

  it('gives nDCG 1 for the ideal ranking', () => {
    expect(ndcgAtK(['a', 'e', 'x', 'c'], GAINS, 4)).toBeCloseTo(1, 10);
  });

  it('ranks a full hit above a partial one in nDCG but not in recall', () => {
    const g = gains({ a: 1, c: 0.5 });
    expect(ndcgAtK(['c', 'a'], g, 2)!).toBeLessThan(ndcgAtK(['a', 'c'], g, 2)!);
    expect(recallAtK(['c', 'a'], g, 2)).toBe(recallAtK(['a', 'c'], g, 2));
  });

  it('returns null, not NaN, for an empty relevance set', () => {
    const empty = gains({});
    expect(precisionAtK(RANKED, empty, 5)).toBeNull();
    expect(recallAtK(RANKED, empty, 5)).toBeNull();
    expect(ndcgAtK(RANKED, empty, 5)).toBeNull();
    expect(reciprocalRank(RANKED, empty)).toBeNull();
    // A gain of 0 is not relevant either.
    expect(recallAtK(RANKED, gains({ a: 0 }), 5)).toBeNull();
  });

  it('returns 0 for an empty ranking when something is relevant', () => {
    expect(precisionAtK([], GAINS, 5)).toBe(0);
    expect(recallAtK([], GAINS, 5)).toBe(0);
    expect(ndcgAtK([], GAINS, 5)).toBe(0);
    expect(reciprocalRank([], GAINS)).toBe(0);
  });

  it('returns null for k below 1', () => {
    expect(precisionAtK(RANKED, GAINS, 0)).toBeNull();
    expect(recallAtK(RANKED, GAINS, 0)).toBeNull();
    expect(ndcgAtK(RANKED, GAINS, 0)).toBeNull();
  });

  describe('reciprocalRank', () => {
    it('uses the first fully relevant item and skips partial ones', () => {
      expect(reciprocalRank(['b', 'c', 'a'], GAINS)).toBeCloseTo(1 / 3);
    });

    it('accepts a lower minGain so a partial hit counts', () => {
      expect(reciprocalRank(['b', 'c', 'a'], GAINS, 0.5)).toBeCloseTo(1 / 2);
    });

    it('is 0 when the relevant item is not retrieved', () => {
      expect(reciprocalRank(['b', 'd'], GAINS)).toBe(0);
    });

    it('is null when only partial items exist', () => {
      expect(reciprocalRank(['c'], gains({ c: 0.5 }))).toBeNull();
    });
  });

  describe('mean', () => {
    it('skips null and NaN', () => {
      expect(mean([1, null, 3, Number.NaN, undefined])).toBe(2);
    });

    it('is null when nothing is defined', () => {
      expect(mean([null, null])).toBeNull();
      expect(mean([])).toBeNull();
    });

    it('averages a metric over rows', () => {
      const rows = [{ v: 0.5 }, { v: null }, { v: 1 }];
      expect(meanBy(rows, (r) => r.v)).toBe(0.75);
    });
  });
});

describe('agreement metrics', () => {
  it('averages ranks over ties', () => {
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
    expect(averageRanks([5, 5, 5])).toEqual([2, 2, 2]);
    expect(averageRanks([3, 1, 2])).toEqual([3, 1, 2]);
  });

  describe('spearman', () => {
    it('handles ties through average ranks', () => {
      // ranks x = [1, 2.5, 2.5, 4], y = [1, 3, 2, 4]: rho = 4.5 / sqrt(22.5)
      expect(spearman([1, 2, 2, 3], [1, 3, 2, 4])).toBeCloseTo(
        3 / Math.sqrt(10),
        10,
      );
    });

    it('is 1 for a monotone relation and -1 for a reversed one', () => {
      expect(spearman([1, 2, 3, 4], [10, 40, 90, 100])).toBeCloseTo(1, 10);
      expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
    });

    it('is null for fewer than 2 pairs or zero variance', () => {
      expect(spearman([1], [1])).toBeNull();
      expect(spearman([], [])).toBeNull();
      expect(spearman([1, 2, 3], [5, 5, 5])).toBeNull();
      expect(spearman([7, 7, 7], [1, 2, 3])).toBeNull();
    });

    it('rejects lists of different lengths', () => {
      expect(() => spearman([1, 2], [1])).toThrow(/length/);
    });
  });

  it('computes MAE and mean signed error', () => {
    // errors: -10, +20, 0
    expect(mae([80, 60, 10], [90, 40, 10])).toBeCloseTo(10);
    expect(meanSignedError([80, 60, 10], [90, 40, 10])).toBeCloseTo(10 / 3);
    expect(mae([], [])).toBeNull();
    expect(meanSignedError([], [])).toBeNull();
  });

  const row = (
    predicted: number,
    actual: number,
    band: Band,
    weight?: number,
  ): AgreementRow => ({ predicted, actual, band, weight });

  it('computes MAE per rule band, null for an empty band', () => {
    const rows = [
      row(80, 90, 'strong'),
      row(70, 90, 'strong'),
      row(50, 50, 'partial'),
    ];
    expect(perBandMae(rows)).toEqual({ strong: 15, partial: 0, weak: null });
  });

  describe('weighted aggregates', () => {
    const rows = [
      row(80, 90, 'strong', 1),
      row(10, 0, 'weak', 3),
      row(50, 10, 'weak', 1),
    ];

    it('weights MAE by pair', () => {
      // (1*10 + 3*10 + 1*40) / 5
      expect(weightedMae(rows)).toBeCloseTo(16);
    });

    it('weights band agreement by pair', () => {
      // strong ok (1), weak ok (3), 50 is partial vs weak (1): 4 / 5
      expect(weightedBandAgreement(rows)).toBeCloseTo(0.8);
    });

    it('defaults the weight to 1', () => {
      const plain = rows.map((r) => ({
        predicted: r.predicted,
        actual: r.actual,
        band: r.band,
      }));
      expect(weightedMae(plain)).toBeCloseTo(20);
      expect(weightedBandAgreement(plain)).toBeCloseTo(2 / 3);
    });

    it('is null for no rows or zero total weight', () => {
      expect(weightedMae([])).toBeNull();
      expect(weightedBandAgreement([])).toBeNull();
      expect(weightedMae([row(1, 2, 'weak', 0)])).toBeNull();
    });
  });

  it('wraps rows into the unweighted statistics', () => {
    const rows = [
      row(10, 20, 'weak'),
      row(50, 40, 'partial'),
      row(90, 80, 'strong'),
    ];
    expect(maeOf(rows)).toBeCloseTo(10);
    expect(spearmanOf(rows)).toBeCloseTo(1, 10);
  });
});

describe('band kappa', () => {
  // Confusion [[2,0,0],[1,1,0],[0,0,2]]: observed 5/6, chance 12/36, kappa 0.75.
  const pairs: Array<{ rule: Band; human: Band }> = [
    { rule: 'strong', human: 'strong' },
    { rule: 'strong', human: 'strong' },
    { rule: 'partial', human: 'strong' },
    { rule: 'partial', human: 'partial' },
    { rule: 'weak', human: 'weak' },
    { rule: 'weak', human: 'weak' },
  ];

  it('reuses the spot-check kappa', () => {
    const k = bandKappas(pairs);
    expect(k.pairs).toBe(6);
    expect(k.exactAgreement).toBeCloseTo(5 / 6);
    expect(k.kappa).toBeCloseTo(0.75);
    expect(k.kappa).toBeCloseTo(cohenKappa(confusionMatrix(pairs)));
    expect(k.confusion).toEqual([
      [2, 0, 0],
      [1, 1, 0],
      [0, 0, 2],
    ]);
  });

  it('returns null instead of NaN for no pairs', () => {
    const k = bandKappas([]);
    expect(k.exactAgreement).toBeNull();
    expect(k.kappa).toBeNull();
    expect(k.quadraticKappa).toBeNull();
  });

  it('compares the scorer band with the rule band', () => {
    const rows: AgreementRow[] = [
      { predicted: 80, actual: 90, band: 'strong' },
      { predicted: 45, actual: 10, band: 'weak' },
      { predicted: 5, actual: 0, band: 'weak' },
    ];
    expect(scorerBandPairs(rows)).toEqual([
      { rule: 'strong', human: bandOf(80) },
      { rule: 'weak', human: 'partial' },
      { rule: 'weak', human: 'weak' },
    ]);
    expect(kappaOf(rows)).toBeCloseTo(
      cohenKappa(confusionMatrix(scorerBandPairs(rows))),
    );
  });
});

describe('bootstrap', () => {
  const values = Array.from({ length: 30 }, (_, i) => i + 1);
  const average = (rows: readonly number[]) => mean(rows);

  it('computes a percentile quantile with interpolation', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4);
    expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
  });

  it('is deterministic under a seed', () => {
    const a = bootstrapCi(values, average, { seed: 7 });
    const b = bootstrapCi(values, average, { seed: 7 });
    const c = bootstrapCi(values, average, { seed: 8 });
    expect(a).toEqual(b);
    expect(a.lo).not.toBe(c.lo);
  });

  it('brackets the point estimate of a mean', () => {
    const ci = bootstrapCi(values, average, { seed: 1 });
    expect(ci.estimate).toBe(15.5);
    expect(ci.lo!).toBeLessThan(15.5);
    expect(ci.hi!).toBeGreaterThan(15.5);
    expect(ci.resamples).toBe(1000);
    expect(ci.valid).toBe(1000);
  });

  it('honours the resample count and confidence level', () => {
    const wide = bootstrapCi(values, average, { seed: 1, confidence: 0.99 });
    const narrow = bootstrapCi(values, average, { seed: 1, confidence: 0.5 });
    expect(wide.hi! - wide.lo!).toBeGreaterThan(narrow.hi! - narrow.lo!);
    expect(
      bootstrapCi(values, average, { seed: 1, resamples: 50 }).resamples,
    ).toBe(50);
  });

  it('collapses to a point for constant data', () => {
    const ci = bootstrapCi([4, 4, 4, 4], average, { seed: 3 });
    expect(ci).toMatchObject({ estimate: 4, lo: 4, hi: 4 });
  });

  it('drops resamples where the statistic is undefined', () => {
    const rows = [
      { predicted: 1, actual: 1, band: 'weak' as Band },
      { predicted: 2, actual: 2, band: 'weak' as Band },
      { predicted: 3, actual: 3, band: 'weak' as Band },
    ];
    // With 3 rows, some resamples repeat one row (zero variance -> null).
    const ci = bootstrapCi(rows, spearmanOf, { seed: 2, resamples: 200 });
    expect(ci.estimate).toBeCloseTo(1, 10);
    expect(ci.valid).toBeLessThan(200);
    expect(ci.valid).toBeGreaterThan(0);
    expect(ci.lo).toBeCloseTo(1, 10);
  });

  it('reports null bounds when no resample is defined', () => {
    const ci = bootstrapCi([1, 2, 3], () => null, { seed: 1, resamples: 10 });
    expect(ci).toEqual({
      estimate: null,
      lo: null,
      hi: null,
      resamples: 10,
      valid: 0,
    });
  });

  describe('paired difference', () => {
    it('resamples both modes at the same indices', () => {
      // B is A shifted by 1 on every pair, so the difference is exactly 1
      // in every resample; unpaired resampling could not guarantee that.
      const a = values.map((v) => v + 1);
      const ci = bootstrapDifference(a, values, average, { seed: 5 });
      expect(ci.estimate).toBeCloseTo(1, 10);
      expect(ci.lo).toBeCloseTo(1, 10);
      expect(ci.hi).toBeCloseTo(1, 10);
    });

    it('is deterministic and brackets a noisy difference', () => {
      const a = values.map((v, i) => v + (i % 3));
      const x = bootstrapDifference(a, values, average, { seed: 9 });
      const y = bootstrapDifference(a, values, average, { seed: 9 });
      expect(x).toEqual(y);
      expect(x.estimate).toBeCloseTo(1, 10);
      expect(x.lo!).toBeLessThanOrEqual(x.estimate!);
      expect(x.hi!).toBeGreaterThanOrEqual(x.estimate!);
      expect(x.lo!).toBeGreaterThan(0);
    });

    it('rejects unpaired lists', () => {
      expect(() =>
        bootstrapDifference([1, 2], [1], average, { seed: 1 }),
      ).toThrow(/length/);
    });
  });
});
