import type { Band, GroundTruthPair } from '../synth/types.js';
import {
  buildEvalSample,
  pairKey,
  pickNoiseSubset,
  type SampledPair,
  type SpotCheckLabel,
} from './sample.js';

/** 5 vacancies x 40 personas: 10 strong, 30 partial, 160 weak. */
function fakeTruth(): GroundTruthPair[] {
  const pairs: GroundTruthPair[] = [];
  let n = 0;
  for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
    for (let p = 1; p <= 40; p++) {
      const band: Band = n < 10 ? 'strong' : n < 40 ? 'partial' : 'weak';
      n++;
      pairs.push({
        vacancyId: v,
        personaId: `p${String(p).padStart(3, '0')}`,
        score: band === 'strong' ? 90 : band === 'partial' ? 50 : 10,
        band,
        requirements: [],
      });
    }
  }
  return pairs;
}

const truth = fakeTruth();
const count = (pairs: readonly SampledPair[], band: Band) =>
  pairs.filter((p) => p.band === band).length;
const label = (p: GroundTruthPair, band: Band | null): SpotCheckLabel => ({
  vacancyId: p.vacancyId,
  personaId: p.personaId,
  band,
});

describe('buildEvalSample', () => {
  it('takes every strong and partial pair and the weak quota', () => {
    const s = buildEvalSample(truth, [], { seed: 1, weak: 20 });
    expect(count(s.pairs, 'strong')).toBe(10);
    expect(count(s.pairs, 'partial')).toBe(30);
    expect(count(s.pairs, 'weak')).toBe(20);
    expect(s.population).toEqual({ strong: 10, partial: 30, weak: 160 });
    expect(s.sampled).toEqual({ strong: 10, partial: 30, weak: 20 });
  });

  it('defaults to 150 weak pairs', () => {
    const big: GroundTruthPair[] = Array.from({ length: 400 }, (_, i) => ({
      vacancyId: 'v',
      personaId: `p${i}`,
      score: 5,
      band: 'weak',
      requirements: [],
    }));
    expect(buildEvalSample(big, [], { seed: 1 }).pairs).toHaveLength(150);
  });

  it('computes weights from the population and sample counts', () => {
    const s = buildEvalSample(truth, [], { seed: 1, weak: 20 });
    for (const p of s.pairs) {
      expect(p.weight).toBe(p.band === 'weak' ? 160 / 20 : 1);
    }
  });

  it('weights sum to the band population', () => {
    const extra = truth.filter((p) => p.band === 'weak').slice(0, 5);
    const s = buildEvalSample(
      truth,
      extra.map((p) => label(p, 'weak')),
      { seed: 2, weak: 20 },
    );
    for (const band of ['strong', 'partial', 'weak'] as const) {
      const total = s.pairs
        .filter((p) => p.band === band)
        .reduce((sum, p) => sum + p.weight, 0);
      expect(total).toBeCloseTo(s.population[band], 10);
    }
  });

  it('adds spot-check pairs once and flags them with the human band', () => {
    const base = buildEvalSample(truth, [], { seed: 3, weak: 20 });
    const inBase = new Set(base.pairs.map(pairKey));
    const weakPairs = truth.filter((p) => p.band === 'weak');
    const outside = weakPairs.find((p) => !inBase.has(pairKey(p)))!;
    const inside = weakPairs.find((p) => inBase.has(pairKey(p)))!;
    const strong = truth.find((p) => p.band === 'strong')!;
    const labels = [
      label(outside, 'partial'),
      label(inside, 'weak'),
      label(strong, 'strong'),
      label(outside, 'partial'),
    ];

    const s = buildEvalSample(truth, labels, { seed: 3, weak: 20 });
    const keys = s.pairs.map(pairKey);
    expect(new Set(keys).size).toBe(keys.length);
    // Only the weak pair outside the random draw is new.
    expect(s.pairs).toHaveLength(base.pairs.length + 1);
    expect(s.pairs.find((p) => pairKey(p) === pairKey(outside))).toMatchObject({
      spotCheck: 'partial',
      band: 'weak',
    });
    expect(s.pairs.find((p) => pairKey(p) === pairKey(inside))!.spotCheck).toBe(
      'weak',
    );
    expect(s.pairs.find((p) => pairKey(p) === pairKey(strong))!.spotCheck).toBe(
      'strong',
    );
    expect(s.pairs.filter((p) => p.spotCheck !== null)).toHaveLength(3);
    expect(s.sampled.weak).toBe(21);
    expect(s.pairs.find((p) => p.band === 'weak')!.weight).toBeCloseTo(
      160 / 21,
    );
  });

  it('includes an unlabelled spot-check pair without a flag', () => {
    const weak = truth.find((p) => p.band === 'weak')!;
    const s = buildEvalSample(truth, [label(weak, null)], { seed: 1, weak: 0 });
    expect(
      s.pairs.find((p) => pairKey(p) === pairKey(weak))!.spotCheck,
    ).toBeNull();
    expect(count(s.pairs, 'weak')).toBe(1);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const a = buildEvalSample(truth, [], { seed: 5, weak: 20 });
    const b = buildEvalSample(truth, [], { seed: 5, weak: 20 });
    const c = buildEvalSample(truth, [], { seed: 6, weak: 20 });
    expect(a).toEqual(b);
    expect(a.pairs.map(pairKey)).not.toEqual(c.pairs.map(pairKey));
  });

  it('does not depend on the order of the input', () => {
    const a = buildEvalSample(truth, [], { seed: 5, weak: 20 });
    const b = buildEvalSample([...truth].reverse(), [], { seed: 5, weak: 20 });
    expect(b).toEqual(a);
  });

  it('returns pairs sorted by vacancy and persona', () => {
    const s = buildEvalSample(truth, [], { seed: 1, weak: 20 });
    const keys = s.pairs.map(pairKey);
    expect(keys).toEqual([...keys].sort());
  });

  it('takes all weak pairs when the quota exceeds the population', () => {
    const s = buildEvalSample(truth, [], { seed: 1, weak: 1000 });
    expect(count(s.pairs, 'weak')).toBe(160);
    expect(s.pairs.every((p) => p.weight === 1)).toBe(true);
  });

  it('rejects a spot-check pair that is not in the ground truth', () => {
    expect(() =>
      buildEvalSample(
        truth,
        [{ vacancyId: 'nope', personaId: 'p001', band: 'weak' }],
        { seed: 1 },
      ),
    ).toThrow(/not in ground-truth/);
  });
});

describe('pickNoiseSubset', () => {
  const sample = buildEvalSample(truth, [], { seed: 1, weak: 40 }).pairs;

  it('stratifies across bands with equal shares', () => {
    const subset = pickNoiseSubset(sample, 12, 1);
    expect(subset).toHaveLength(12);
    expect(count(subset, 'strong')).toBe(4);
    expect(count(subset, 'partial')).toBe(4);
    expect(count(subset, 'weak')).toBe(4);
  });

  it('gives the remainder to partial first, then strong', () => {
    const subset = pickNoiseSubset(sample, 14, 1);
    expect(count(subset, 'partial')).toBe(5);
    expect(count(subset, 'strong')).toBe(5);
    expect(count(subset, 'weak')).toBe(4);
  });

  it('returns distinct pairs from the sample, in sample order', () => {
    const subset = pickNoiseSubset(sample, 12, 1);
    const keys = subset.map(pairKey);
    expect(new Set(keys).size).toBe(12);
    const order = sample.map(pairKey);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
  });

  it('is deterministic for a seed', () => {
    expect(pickNoiseSubset(sample, 12, 3)).toEqual(
      pickNoiseSubset(sample, 12, 3),
    );
    expect(pickNoiseSubset(sample, 12, 3).map(pairKey)).not.toEqual(
      pickNoiseSubset(sample, 12, 4).map(pairKey),
    );
  });

  it('fills the shortfall of a short band from the others', () => {
    const short = [
      ...sample.filter((p) => p.band === 'strong').slice(0, 3),
      ...sample.filter((p) => p.band === 'partial').slice(0, 20),
      ...sample.filter((p) => p.band === 'weak').slice(0, 20),
    ];
    const subset = pickNoiseSubset(short, 30, 1);
    expect(subset).toHaveLength(30);
    expect(count(subset, 'strong')).toBe(3);
  });

  it('returns the whole sample when it is smaller than the request', () => {
    const tiny = sample.slice(0, 5);
    expect(pickNoiseSubset(tiny, 50, 1)).toHaveLength(5);
  });
});
