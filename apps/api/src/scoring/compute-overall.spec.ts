import { computeOverall } from './compute-overall.js';

describe('computeOverall', () => {
  it('returns 0 for no criteria', () => {
    expect(computeOverall([])).toBe(0);
  });

  it('weights must-haves twice as much as nice-to-haves', () => {
    // (100*2 + 40*1) / 3 = 80
    expect(
      computeOverall([
        { score: 100, importance: 'must' },
        { score: 40, importance: 'nice' },
      ]),
    ).toBe(80);
  });

  it('is a plain mean when importances are equal', () => {
    expect(
      computeOverall([
        { score: 10, importance: 'nice' },
        { score: 30, importance: 'nice' },
      ]),
    ).toBe(20);
  });

  it('rounds to an integer', () => {
    // (50*2 + 0*2 + 100*1) / 5 = 40 ; (1*2 + 0*1) / 3 = 0.67 -> 1
    expect(
      computeOverall([
        { score: 50, importance: 'must' },
        { score: 0, importance: 'must' },
        { score: 100, importance: 'nice' },
      ]),
    ).toBe(40);
    expect(
      computeOverall([
        { score: 1, importance: 'must' },
        { score: 0, importance: 'nice' },
      ]),
    ).toBe(1);
  });
});
