/**
 * Pure metrics of the eval harness: retrieval quality, score agreement with
 * the rule, band kappa and bootstrap confidence intervals. No I/O, no LLM.
 */
import { bandOf } from '../synth/ground-truth.js';
import { createRng } from '../synth/rng.js';
import {
  cohenKappa,
  confusionMatrix,
  quadraticWeightedKappa,
  type ConfusionMatrix,
} from '../synth/spot-check.js';
import type { Band } from '../synth/types.js';

// --- Retrieval ---------------------------------------------------------------

/**
 * Graded relevance of one query or vacancy: id -> gain. Relevant = 1,
 * partially relevant = 0.5; ids that are absent count as 0.
 */
export type Gains = ReadonlyMap<string, number>;

/** `null` marks a metric that is undefined for the input (never NaN). */
export type Maybe = number | null;

const gainOf = (gains: Gains, id: string): number => gains.get(id) ?? 0;

/** Number of ids with a gain above 0. */
const relevantCount = (gains: Gains): number =>
  [...gains.values()].filter((g) => g > 0).length;

/** The first `k` distinct ids of a ranked list (a repeated id counts once). */
function topK(ranked: readonly string[], k: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ranked) {
    if (out.length >= k) break;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Precision@k: the share of the first `k` ranks that are relevant. Hit
 * definition (shared with `recallAtK`): any gain above 0, so a partially
 * relevant item counts as a hit. The denominator is always `k`, so a list
 * shorter than `k` is penalised; report the result count next to it.
 * `null` when nothing is relevant or `k < 1`.
 */
export function precisionAtK(
  ranked: readonly string[],
  gains: Gains,
  k: number,
): Maybe {
  if (k < 1 || relevantCount(gains) === 0) return null;
  const hits = topK(ranked, k).filter((id) => gainOf(gains, id) > 0).length;
  return hits / k;
}

/**
 * Recall@k: hits in the first `k` ranks over all relevant items. A hit is any
 * gain above 0 (partial counts as a full hit, same as `precisionAtK`); the
 * graded view lives in nDCG. `null` for an empty relevance set or `k < 1`.
 */
export function recallAtK(
  ranked: readonly string[],
  gains: Gains,
  k: number,
): Maybe {
  const total = relevantCount(gains);
  if (k < 1 || total === 0) return null;
  const hits = topK(ranked, k).filter((id) => gainOf(gains, id) > 0).length;
  return hits / total;
}

const discount = (rank: number): number => Math.log2(rank + 1);

/**
 * nDCG@k with graded gains and the standard log2 discount: DCG sums
 * gain / log2(rank + 1) over the first `k` ranks (rank starts at 1); the ideal
 * ordering is the relevance set sorted by gain. `null` for an empty relevance
 * set or `k < 1`.
 */
export function ndcgAtK(
  ranked: readonly string[],
  gains: Gains,
  k: number,
): Maybe {
  if (k < 1 || relevantCount(gains) === 0) return null;
  const dcg = topK(ranked, k).reduce(
    (sum, id, i) => sum + gainOf(gains, id) / discount(i + 1),
    0,
  );
  const ideal = [...gains.values()]
    .filter((g) => g > 0)
    .sort((a, b) => b - a)
    .slice(0, k)
    .reduce((sum, g, i) => sum + g / discount(i + 1), 0);
  return dcg / ideal;
}

/**
 * Reciprocal rank: 1 / rank of the first item with gain >= `minGain`. By
 * default only fully relevant items (gain 1) count, so a partial hit does not
 * stop the search. 0 when no such item is in the list; `null` when the
 * relevance set has no item with that gain (nothing could be found).
 */
export function reciprocalRank(
  ranked: readonly string[],
  gains: Gains,
  minGain = 1,
): Maybe {
  if (![...gains.values()].some((g) => g >= minGain)) return null;
  const rank = topK(ranked, ranked.length).findIndex(
    (id) => gainOf(gains, id) >= minGain,
  );
  return rank === -1 ? 0 : 1 / (rank + 1);
}

/** Mean of the defined values (null and NaN are skipped); null when none. */
export function mean(values: ReadonlyArray<number | null | undefined>): Maybe {
  const defined = values.filter(
    (v): v is number => typeof v === 'number' && !Number.isNaN(v),
  );
  if (defined.length === 0) return null;
  return defined.reduce((a, b) => a + b, 0) / defined.length;
}

/** Mean of one metric over a list of rows (queries or vacancies). */
export const meanBy = <T>(
  rows: readonly T[],
  metric: (row: T) => Maybe,
): Maybe => mean(rows.map(metric));

// --- Agreement ---------------------------------------------------------------

/** One scored pair: the scorer's overall against the rule's. */
export interface AgreementRow {
  /** Scorer overall, 0-100. */
  predicted: number;
  /** Rule score, 0-100. */
  actual: number;
  /** The rule's band for the pair. */
  band: Band;
  /** Sampling weight (population size / sample size of the band); default 1. */
  weight?: number;
}

const weightOf = (row: { weight?: number }): number => row.weight ?? 1;

/** Average ranks (1-based); tied values share the mean of their positions. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
    const rank = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[order[t].index] = rank;
    i = j + 1;
  }
  return ranks;
}

function pearson(x: readonly number[], y: readonly number[]): Maybe {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function assertSameLength(a: readonly unknown[], b: readonly unknown[]): void {
  if (a.length !== b.length) {
    throw new Error(
      `Paired lists differ in length: ${a.length} vs ${b.length}`,
    );
  }
}

/**
 * Spearman's rho: Pearson correlation of the average ranks, so ties are
 * handled. `null` for fewer than 2 pairs or when either side has no variance.
 */
export function spearman(x: readonly number[], y: readonly number[]): Maybe {
  assertSameLength(x, y);
  if (x.length < 2) return null;
  return pearson(averageRanks(x), averageRanks(y));
}

/** Mean absolute error between two paired lists; `null` when empty. */
export function mae(
  predicted: readonly number[],
  actual: readonly number[],
): Maybe {
  assertSameLength(predicted, actual);
  return mean(predicted.map((p, i) => Math.abs(p - actual[i])));
}

/** Mean of (predicted - actual): positive when the scorer runs high. */
export function meanSignedError(
  predicted: readonly number[],
  actual: readonly number[],
): Maybe {
  assertSameLength(predicted, actual);
  return mean(predicted.map((p, i) => p - actual[i]));
}

/** Rows of one rule band. */
const inBand = (rows: readonly AgreementRow[], band: Band): AgreementRow[] =>
  rows.filter((r) => r.band === band);

/** MAE per rule band (`null` for a band with no rows). */
export function perBandMae(rows: readonly AgreementRow[]): Record<Band, Maybe> {
  const of = (band: Band): Maybe => {
    const subset = inBand(rows, band);
    return mae(
      subset.map((r) => r.predicted),
      subset.map((r) => r.actual),
    );
  };
  return { strong: of('strong'), partial: of('partial'), weak: of('weak') };
}

/** Weighted mean of `value` over rows; `null` when the weights sum to 0. */
function weightedMean(
  rows: readonly AgreementRow[],
  value: (row: AgreementRow) => number,
): Maybe {
  const total = rows.reduce((sum, r) => sum + weightOf(r), 0);
  if (rows.length === 0 || total === 0) return null;
  return rows.reduce((sum, r) => sum + weightOf(r) * value(r), 0) / total;
}

/** MAE with each pair weighted (the population view of a stratified sample). */
export const weightedMae = (rows: readonly AgreementRow[]): Maybe =>
  weightedMean(rows, (r) => Math.abs(r.predicted - r.actual));

/** Weighted share of pairs where the scorer's band equals the rule's band. */
export const weightedBandAgreement = (rows: readonly AgreementRow[]): Maybe =>
  weightedMean(rows, (r) => (bandOf(r.predicted) === r.band ? 1 : 0));

/** Spearman of an agreement sample (sample only, not reweighted). */
export const spearmanOf = (rows: readonly AgreementRow[]): Maybe =>
  spearman(
    rows.map((r) => r.predicted),
    rows.map((r) => r.actual),
  );

/** MAE of an agreement sample (unweighted). */
export const maeOf = (rows: readonly AgreementRow[]): Maybe =>
  mae(
    rows.map((r) => r.predicted),
    rows.map((r) => r.actual),
  );

// --- Kappa -------------------------------------------------------------------

export interface BandPair {
  rule: Band;
  /** The other rater: the scorer's band, or Dude's label. */
  human: Band;
}

export interface BandKappas {
  pairs: number;
  exactAgreement: Maybe;
  kappa: Maybe;
  quadraticKappa: Maybe;
  /** Rows: rule band, columns: other rater, both in `BANDS` order. */
  confusion: ConfusionMatrix;
}

const finite = (x: number): Maybe => (Number.isNaN(x) ? null : x);

/**
 * Band agreement of two raters, built on `spot-check.ts` (confusion matrix and
 * both kappas); this only maps NaN to null. Use `scorerBandPairs` to compare
 * the scorer with the rule.
 */
export function bandKappas(pairs: readonly BandPair[]): BandKappas {
  const confusion = confusionMatrix(pairs);
  const agreed = pairs.filter((p) => p.rule === p.human).length;
  return {
    pairs: pairs.length,
    exactAgreement: pairs.length === 0 ? null : agreed / pairs.length,
    kappa: finite(cohenKappa(confusion)),
    quadraticKappa: finite(quadraticWeightedKappa(confusion)),
    confusion,
  };
}

/** The rule's band against the band of the scorer's overall (`bandOf`). */
export const scorerBandPairs = (rows: readonly AgreementRow[]): BandPair[] =>
  rows.map((r) => ({ rule: r.band, human: bandOf(r.predicted) }));

/** Unweighted Cohen's kappa of the scorer's bands against the rule's. */
export const kappaOf = (rows: readonly AgreementRow[]): Maybe =>
  bandKappas(scorerBandPairs(rows)).kappa;

/** Quadratic weighted kappa of the scorer's bands against the rule's. */
export const quadraticKappaOf = (rows: readonly AgreementRow[]): Maybe =>
  bandKappas(scorerBandPairs(rows)).quadraticKappa;

// --- Bootstrap ---------------------------------------------------------------

export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_CONFIDENCE = 0.95;

export interface BootstrapOptions {
  seed: number;
  /** Default 1000. */
  resamples?: number;
  /** Default 0.95. */
  confidence?: number;
}

export interface ConfidenceInterval {
  /** The statistic on the original rows. */
  estimate: Maybe;
  lo: Maybe;
  hi: Maybe;
  resamples: number;
  /** Resamples where the statistic was defined; the interval uses only those. */
  valid: number;
}

/** Quantile `q` in [0, 1] of a sorted list, linear interpolation. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = q * (sorted.length - 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (pos - lower);
}

function intervalOf(
  estimate: Maybe,
  draws: readonly Maybe[],
  confidence: number,
): ConfidenceInterval {
  const valid = draws
    .filter((d): d is number => d !== null && !Number.isNaN(d))
    .sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  return {
    estimate,
    lo: valid.length === 0 ? null : quantile(valid, alpha),
    hi: valid.length === 0 ? null : quantile(valid, 1 - alpha),
    resamples: draws.length,
    valid: valid.length,
  };
}

/** `n` indices drawn with replacement from 0..n-1. */
const resampleIndices = (n: number, next: () => number): number[] =>
  Array.from({ length: n }, () => Math.floor(next() * n));

/**
 * Percentile bootstrap CI of `statistic` over `rows`. Rows are resampled with
 * replacement; deterministic for a seed.
 */
export function bootstrapCi<T>(
  rows: readonly T[],
  statistic: (rows: readonly T[]) => Maybe,
  options: BootstrapOptions,
): ConfidenceInterval {
  const { seed, resamples = DEFAULT_RESAMPLES } = options;
  const rng = createRng(seed);
  const draws: Maybe[] = [];
  for (let b = 0; b < resamples; b++) {
    const idx = resampleIndices(rows.length, rng.next);
    draws.push(statistic(idx.map((i) => rows[i])));
  }
  return intervalOf(
    statistic(rows),
    draws,
    options.confidence ?? DEFAULT_CONFIDENCE,
  );
}

/**
 * Paired bootstrap of `statistic(rowsA) - statistic(rowsB)`: `rowsA[i]` and
 * `rowsB[i]` are the same pair under the two modes, and both are resampled at
 * the same indices. A CI that excludes 0 means the modes differ beyond sample
 * noise. Resamples where either statistic is undefined are dropped.
 */
export function bootstrapDifference<T>(
  rowsA: readonly T[],
  rowsB: readonly T[],
  statistic: (rows: readonly T[]) => Maybe,
  options: BootstrapOptions,
): ConfidenceInterval {
  assertSameLength(rowsA, rowsB);
  const { seed, resamples = DEFAULT_RESAMPLES } = options;
  const diff = (a: Maybe, b: Maybe): Maybe =>
    a === null || b === null ? null : a - b;
  const rng = createRng(seed);
  const draws: Maybe[] = [];
  for (let b = 0; b < resamples; b++) {
    const idx = resampleIndices(rowsA.length, rng.next);
    draws.push(
      diff(
        statistic(idx.map((i) => rowsA[i])),
        statistic(idx.map((i) => rowsB[i])),
      ),
    );
  }
  return intervalOf(
    diff(statistic(rowsA), statistic(rowsB)),
    draws,
    options.confidence ?? DEFAULT_CONFIDENCE,
  );
}
