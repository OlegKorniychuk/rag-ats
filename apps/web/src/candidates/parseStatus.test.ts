import { describe, expect, it } from 'vitest';
import { hasParseInFlight, isParseInFlight } from './parseStatus';

describe('isParseInFlight', () => {
  it.each([
    ['pending', true],
    ['parsing', true],
    ['parsed', false],
    ['failed', false],
  ] as const)('%s -> %s', (status, expected) => {
    expect(isParseInFlight(status)).toBe(expected);
  });
});

describe('hasParseInFlight', () => {
  it('is false for undefined and empty lists', () => {
    expect(hasParseInFlight(undefined)).toBe(false);
    expect(hasParseInFlight([])).toBe(false);
  });

  it('is true when any candidate is pending or parsing', () => {
    expect(
      hasParseInFlight([{ parseStatus: 'parsed' }, { parseStatus: 'parsing' }]),
    ).toBe(true);
  });

  it('is false when all are settled', () => {
    expect(
      hasParseInFlight([{ parseStatus: 'parsed' }, { parseStatus: 'failed' }]),
    ).toBe(false);
  });
});
