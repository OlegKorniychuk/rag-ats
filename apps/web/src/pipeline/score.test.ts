import { describe, expect, it } from 'vitest';
import type { ApplicationScore, ParseStatus } from '@rag-ats/shared';
import {
  hasScoreInFlight,
  isBlockedByFailedParse,
  isStaleInFlight,
  isStaleSettled,
  scoreBand,
} from './score';

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

const parsed = { parseStatus: 'parsed' as ParseStatus };
const failedParse = { parseStatus: 'failed' as ParseStatus };
const waiting = (status: ApplicationScore['status'] = 'pending') => ({
  ...score(status),
  waitingForParse: true,
});

describe('isBlockedByFailedParse', () => {
  it('is true only for a pending score waiting on a failed parse', () => {
    expect(isBlockedByFailedParse(waiting(), 'failed')).toBe(true);
  });

  it.each(['pending', 'parsing', 'parsed'] as const)(
    'is false while the parse is %s',
    (parseStatus) => {
      expect(isBlockedByFailedParse(waiting(), parseStatus)).toBe(false);
    },
  );

  it('is false without a parse status', () => {
    expect(isBlockedByFailedParse(waiting(), undefined)).toBe(false);
  });

  it('is false when the score is not waiting for the parse', () => {
    expect(isBlockedByFailedParse(score('pending'), 'failed')).toBe(false);
  });

  it('is false for a score that is not pending', () => {
    expect(isBlockedByFailedParse(waiting('scoring'), 'failed')).toBe(false);
    expect(isBlockedByFailedParse(waiting('failed'), 'failed')).toBe(false);
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
        { score: score('scored'), candidate: parsed },
        { score: score('failed'), candidate: parsed },
      ]),
    ).toBe(false);
  });

  it.each(['pending', 'scoring'] as const)(
    'is true for a %s score',
    (status) => {
      expect(
        hasScoreInFlight([
          { score: score('scored'), candidate: parsed },
          { score: score(status), candidate: parsed },
        ]),
      ).toBe(true);
    },
  );

  it('is true for a score waiting on a parse that is still running', () => {
    expect(
      hasScoreInFlight([
        { score: waiting(), candidate: { parseStatus: 'parsing' } },
      ]),
    ).toBe(true);
  });

  it('ignores a score waiting on a failed parse', () => {
    expect(
      hasScoreInFlight([{ score: waiting(), candidate: failedParse }]),
    ).toBe(false);
  });

  it('still counts other in-flight scores next to one blocked by a failed parse', () => {
    expect(
      hasScoreInFlight([
        { score: waiting(), candidate: failedParse },
        { score: score('scoring'), candidate: parsed },
      ]),
    ).toBe(true);
  });
});

describe('isStaleInFlight / isStaleSettled', () => {
  const make = (
    status: ApplicationScore['status'],
    stale: boolean,
  ): ApplicationScore => ({ ...score(status), stale });

  it.each([
    ['pending', true, true, false],
    ['scoring', true, true, false],
    ['scored', true, false, true],
    ['failed', true, false, true],
    ['pending', false, false, false],
    ['scored', false, false, false],
  ] as const)(
    '%s, stale=%s -> inFlight=%s, settled=%s',
    (status, stale, inFlight, settled) => {
      expect(isStaleInFlight(make(status, stale))).toBe(inFlight);
      expect(isStaleSettled(make(status, stale))).toBe(settled);
    },
  );
});
