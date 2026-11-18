/**
 * Stratified sample of ground-truth pairs for the scoring eval, and the
 * noise subset that is scored a second time. Pure and seeded: the same inputs
 * and seed give the same sample, whatever the order of the input.
 */
import { createRng } from '../synth/rng.js';
import { bandQuotas, BANDS } from '../synth/spot-check.js';
import type { Band, GroundTruthPair } from '../synth/types.js';

export const DEFAULT_WEAK = 150;
export const DEFAULT_NOISE = 50;

/** A spot-check label: the identity of a pair plus Dude's band, if given. */
export interface SpotCheckLabel {
  vacancyId: string;
  personaId: string;
  band: Band | null;
}

export interface SampledPair {
  vacancyId: string;
  personaId: string;
  /** The rule's score and band. */
  score: number;
  band: Band;
  /**
   * Population pairs of the band over sampled pairs of the band, computed from
   * the final sample (strong and partial are fully included, so 1). The
   * spot-check pairs that join the weak band are not random draws; counting
   * them keeps the weights summing to the population.
   */
  weight: number;
  /** Dude's band when the pair is one of the spot-check pairs, else null. */
  spotCheck: Band | null;
}

export interface EvalSample {
  seed: number;
  pairs: SampledPair[];
  /** Pairs per rule band in the whole ground truth. */
  population: Record<Band, number>;
  /** Pairs per rule band in the sample. */
  sampled: Record<Band, number>;
}

export interface SampleOptions {
  seed: number;
  /** Weak pairs drawn at random (default 150). */
  weak?: number;
}

export const pairKey = (p: { vacancyId: string; personaId: string }): string =>
  `${p.vacancyId}|${p.personaId}`;

const byKey = (a: GroundTruthPair, b: GroundTruthPair): number =>
  pairKey(a) < pairKey(b) ? -1 : pairKey(a) > pairKey(b) ? 1 : 0;

const countByBand = (
  pairs: ReadonlyArray<{ band: Band }>,
): Record<Band, number> => {
  const counts: Record<Band, number> = { strong: 0, partial: 0, weak: 0 };
  for (const p of pairs) counts[p.band]++;
  return counts;
};

/**
 * All strong, all partial, `weak` random weak pairs, and every spot-check pair
 * not already in, each pair once. The result is sorted by vacancy and persona.
 * A spot-check label whose pair is not in the ground truth is an error.
 */
export function buildEvalSample(
  truth: readonly GroundTruthPair[],
  spotCheck: readonly SpotCheckLabel[],
  options: SampleOptions,
): EvalSample {
  const { seed, weak = DEFAULT_WEAK } = options;
  const rng = createRng(seed);
  const ordered = [...truth].sort(byKey);
  const chosen = new Map<string, GroundTruthPair>();

  for (const p of ordered) {
    if (p.band !== 'weak') chosen.set(pairKey(p), p);
  }
  const weakPairs = ordered.filter((p) => p.band === 'weak');
  for (const p of rng.sample(weakPairs, weak)) chosen.set(pairKey(p), p);

  const truthByKey = new Map(ordered.map((p) => [pairKey(p), p] as const));
  const human = new Map<string, Band>();
  for (const label of spotCheck) {
    const key = pairKey(label);
    const gt = truthByKey.get(key);
    if (!gt) {
      throw new Error(
        `Spot-check pair (${label.vacancyId}, ${label.personaId}) is not in ground-truth.json`,
      );
    }
    if (label.band) human.set(key, label.band);
    chosen.set(key, gt);
  }

  const population = countByBand(truth);
  const picked = [...chosen.values()].sort(byKey);
  const sampled = countByBand(picked);
  return {
    seed,
    population,
    sampled,
    pairs: picked.map((p) => ({
      vacancyId: p.vacancyId,
      personaId: p.personaId,
      score: p.score,
      band: p.band,
      weight: population[p.band] / sampled[p.band],
      spotCheck: human.get(pairKey(p)) ?? null,
    })),
  };
}

/**
 * The pairs scored a second time to measure run-to-run noise: `size` pairs
 * with equal shares per band (`bandQuotas`; a short band hands its quota to
 * the others), drawn by the seeded RNG. Returned in sample order.
 */
export function pickNoiseSubset(
  sample: readonly SampledPair[],
  size: number,
  seed: number,
): SampledPair[] {
  const rng = createRng(seed);
  const quotas = bandQuotas(Math.min(size, sample.length));
  const chosen = new Set<SampledPair>();
  for (const band of BANDS) {
    const inBand = sample.filter((p) => p.band === band);
    for (const p of rng.sample(inBand, quotas[band])) chosen.add(p);
  }
  // A band that ran dry leaves a shortfall: fill it from the other bands.
  const target = Math.min(size, sample.length);
  if (chosen.size < target) {
    const rest = rng.shuffle(sample.filter((p) => !chosen.has(p)));
    for (const p of rest.slice(0, target - chosen.size)) chosen.add(p);
  }
  return sample.filter((p) => chosen.has(p));
}
