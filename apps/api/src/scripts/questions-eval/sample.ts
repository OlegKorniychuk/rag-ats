import { createRng } from '../synth/rng.js';
import type { Band } from '../synth/types.js';

export const BANDS: readonly Band[] = ['strong', 'partial', 'weak'];

/** A seeded application with a current score, and its ground-truth band. */
export interface QuestionsSampleItem {
  applicationId: string;
  vacancySpecId: string;
  personaId: string;
  band: Band;
}

/**
 * Up to `perBand` items of each band (all of a smaller band), drawn with a
 * seeded RNG from the items sorted by key, so the result depends on the seed
 * only. Bands come in the order strong, partial, weak.
 */
export function sampleScoredApplications(
  candidates: QuestionsSampleItem[],
  perBand: number,
  seed: number,
): QuestionsSampleItem[] {
  const rng = createRng(seed);
  const key = (item: QuestionsSampleItem) =>
    `${item.vacancySpecId}\u0000${item.personaId}\u0000${item.applicationId}`;
  return BANDS.flatMap((band) => {
    const inBand = candidates
      .filter((c) => c.band === band)
      .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return rng.sample(inBand, perBand);
  });
}
