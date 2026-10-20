import { describe, expect, it } from 'vitest';
import type { ApplicationScore } from '@rag-ats/shared';
import { hasScoreInFlight, scoreBand } from './score';

const score = (status: ApplicationScore['status']): ApplicationScore => ({
  status,
  error: null,
  waitingForParse: false,
  stale: false,
  result: null,
});

describe('scoreBand', () => {
  it.each([
    [100, 'success'],
    [75, 'success'],
    [74, 'warning'],
    [50, 'warning'],
    [49, 'error'],
    [0, 'error'],
  ])('maps %i to %s', (overall, band) => {
    expect(scoreBand(overall)).toBe(band);
  });
});

describe('hasScoreInFlight', () => {
  it('is false for undefined and empty lists', () => {
    expect(hasScoreInFlight(undefined)).toBe(false);
    expect(hasScoreInFlight([])).toBe(false);
  });

  it('is false when every score is settled', () => {
    expect(
      hasScoreInFlight([
        { score: score('scored') },
        { score: score('failed') },
      ]),
    ).toBe(false);
  });

  it.each(['pending', 'scoring'] as const)(
    'is true for a %s score',
    (status) => {
      expect(
        hasScoreInFlight([
          { score: score('scored') },
          { score: score(status) },
        ]),
      ).toBe(true);
    },
  );
});
