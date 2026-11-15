import { createRng } from './rng.js';
import {
  ANCHOR,
  layoutTimeline,
  monthIndex,
  monthsToYears,
  roleMonths,
  splitMonths,
} from './timeline.js';

describe('timeline', () => {
  it('measures role months, open roles run to the anchor', () => {
    expect(roleMonths({ start: '2020-01', end: '2021-01' })).toBe(12);
    expect(roleMonths({ start: '2026-04', end: null })).toBe(6);
    expect(ANCHOR).toBe('2026-10');
  });

  it('keeps month/year conversion exact around the boundary', () => {
    expect(monthsToYears(36)).toBe(3);
    expect(monthsToYears(35)).toBeLessThan(3);
  });

  it('splits months into pieces that sum up and respect the minimum', () => {
    const rng = createRng(4);
    for (let i = 0; i < 50; i++) {
      const pieces = splitMonths(60, 3, 8, rng);
      expect(pieces.reduce((a, b) => a + b, 0)).toBe(60);
      expect(Math.min(...pieces)).toBeGreaterThanOrEqual(8);
    }
    expect(splitMonths(10, 4, 8, rng)).toEqual([10]);
  });

  it('lays out consecutive roles that never end after the anchor', () => {
    const rng = createRng(2);
    for (const current of [true, false]) {
      const durations = [20, 14, 30];
      const roles = layoutTimeline(durations, rng, current);
      expect(roles).toHaveLength(3);
      roles.forEach((role, i) => {
        expect(roleMonths(role)).toBe(durations[i]);
        if (i > 0) {
          const gap = monthIndex(role.start) - monthIndex(roles[i - 1].end!);
          expect(gap).toBeGreaterThanOrEqual(0);
          expect(gap).toBeLessThanOrEqual(2);
        }
      });
      const last = roles[2];
      if (current) expect(last.end).toBeNull();
      else expect(monthIndex(last.end!)).toBeLessThan(monthIndex(ANCHOR));
    }
  });
});
