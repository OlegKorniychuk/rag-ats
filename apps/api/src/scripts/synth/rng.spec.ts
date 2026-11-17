import { createRng } from './rng.js';

describe('createRng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
    const c = createRng(8);
    expect(Array.from({ length: 10 }, () => c.next())).not.toEqual(seqA);
  });

  it('keeps next() in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int covers both inclusive bounds', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(2, 5));
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('shuffle returns a permutation and leaves the input alone', () => {
    const rng = createRng(5);
    const input = [1, 2, 3, 4, 5, 6];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(input);
  });

  it('sample returns distinct items, capped at the list size', () => {
    const rng = createRng(9);
    const out = rng.sample(['a', 'b', 'c'], 5);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
    expect(rng.sample(['a', 'b', 'c'], 2)).toHaveLength(2);
  });

  it('pick throws on an empty list', () => {
    expect(() => createRng(1).pick([])).toThrow('empty');
  });

  it('chance and weighted respect extremes', () => {
    const rng = createRng(11);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    for (let i = 0; i < 50; i++) {
      expect(
        rng.weighted([
          ['x', 0],
          ['y', 1],
        ]),
      ).toBe('y');
    }
  });
});
