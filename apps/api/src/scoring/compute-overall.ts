export const IMPORTANCE_WEIGHTS = { must: 2, nice: 1 } as const;

/** Weighted mean of criterion scores (must x2, nice x1), rounded; 0 for none. */
export function computeOverall(
  criteria: Array<{ score: number; importance: 'must' | 'nice' }>,
): number {
  let weighted = 0;
  let weights = 0;
  for (const c of criteria) {
    const w = IMPORTANCE_WEIGHTS[c.importance];
    weighted += c.score * w;
    weights += w;
  }
  return weights === 0 ? 0 : Math.round(weighted / weights);
}
