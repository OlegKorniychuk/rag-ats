/** Small seeded PRNG (mulberry32) so every generated artefact is reproducible. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates on a copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** `count` distinct items (fewer when the list is shorter). */
  sample<T>(items: readonly T[], count: number): T[];
  chance(probability: number): boolean;
  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('rng.pick: empty list');
    return items[int(0, items.length - 1)];
  };
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return {
    next,
    int,
    pick,
    shuffle,
    sample: (items, count) => shuffle(items).slice(0, Math.max(0, count)),
    chance: (probability) => next() < probability,
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let r = next() * total;
      for (const [value, weight] of entries) {
        r -= weight;
        if (r < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}
