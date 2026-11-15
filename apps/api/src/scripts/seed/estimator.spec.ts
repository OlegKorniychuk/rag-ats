import {
  criteriaEstimateUsd,
  estimate,
  personaEstimateUsd,
  renderEstimate,
  UNIT_COST_USD,
} from './estimator.js';

const COUNTS = {
  personas: 100,
  applications: 250,
  parses: 100,
  embeddings: 100,
  criteriaExtractions: 10,
  scores: 250,
};

describe('estimate', () => {
  it('multiplies the measured unit costs and adds the margin', () => {
    const result = estimate(COUNTS);
    const subtotal = 100 * 0.0028 + 10 * 0.003 + 250 * 0.0053 + 100 * 0.00002;
    expect(result.subtotalUsd).toBeCloseTo(subtotal, 10);
    expect(result.totalUsd).toBeCloseTo(subtotal * 1.3, 10);
    expect(result.lines.map((l) => l.count)).toEqual([100, 10, 250, 100]);
  });

  it('is zero for no work', () => {
    const none = {
      personas: 0,
      applications: 0,
      parses: 0,
      embeddings: 0,
      criteriaExtractions: 0,
      scores: 0,
    };
    expect(estimate(none).totalUsd).toBe(0);
  });

  it('prints the breakdown and flags an estimate over the cap', () => {
    const text = renderEstimate(estimate(COUNTS), 1);
    expect(text).toContain('CV parses');
    expect(text).toContain('Scores');
    expect(text).toContain('OVER the cap');
    expect(renderEstimate(estimate(COUNTS), 5)).toContain('within the cap');
  });
});

describe('per-work estimates', () => {
  it('a persona costs its scores, plus a parse when the CV is new', () => {
    expect(personaEstimateUsd(2, false)).toBeCloseTo(2 * 0.0053 * 1.3, 10);
    expect(personaEstimateUsd(2, true)).toBeCloseTo(
      (2 * 0.0053 + 0.0028 + 0.00002) * 1.3,
      10,
    );
  });

  it('a criteria extraction carries the margin', () => {
    expect(criteriaEstimateUsd()).toBeCloseTo(UNIT_COST_USD.criteria * 1.3, 10);
  });
});
