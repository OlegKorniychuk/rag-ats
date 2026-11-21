import type { Band } from '../synth/types.js';
import {
  sampleScoredApplications,
  type QuestionsSampleItem,
} from './sample.js';

function items(band: Band, count: number): QuestionsSampleItem[] {
  return Array.from({ length: count }, (_, i) => ({
    applicationId: `${band}-${i}`,
    vacancySpecId: `v${i % 3}`,
    personaId: `p${i}`,
    band,
  }));
}

const pool = [
  ...items('strong', 14),
  ...items('partial', 30),
  ...items('weak', 4),
];

describe('sampleScoredApplications', () => {
  it('takes perBand per band, strong then partial then weak', () => {
    const sample = sampleScoredApplications(pool, 10, 42);
    const count = (band: Band) => sample.filter((s) => s.band === band).length;
    expect(count('strong')).toBe(10);
    expect(count('partial')).toBe(10);
    expect(sample.map((s) => s.band)).toEqual([
      ...Array(10).fill('strong'),
      ...Array(10).fill('partial'),
      ...Array(4).fill('weak'),
    ]);
    expect(new Set(sample.map((s) => s.applicationId)).size).toBe(24);
  });

  it('takes all of a band that has fewer than perBand', () => {
    const sample = sampleScoredApplications(pool, 10, 42);
    expect(sample.filter((s) => s.band === 'weak')).toHaveLength(4);
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a = sampleScoredApplications(pool, 10, 42);
    expect(sampleScoredApplications(pool, 10, 42)).toEqual(a);
    expect(sampleScoredApplications(pool, 10, 43)).not.toEqual(a);
  });

  it('does not depend on the input order', () => {
    expect(sampleScoredApplications([...pool].reverse(), 10, 42)).toEqual(
      sampleScoredApplications(pool, 10, 42),
    );
  });
});
