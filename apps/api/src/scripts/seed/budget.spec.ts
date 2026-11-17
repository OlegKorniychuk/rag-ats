import { canSubmit, queuedEstimateUsd } from './budget.js';

describe('canSubmit', () => {
  it('allows work that fits under the cap', () => {
    expect(canSubmit(1, 0.5, 0.5, 3)).toBe(true);
  });

  it('allows exactly the cap', () => {
    expect(canSubmit(1, 1, 1, 3)).toBe(true);
  });

  it('refuses when spend plus queued plus next passes the cap', () => {
    expect(canSubmit(1, 1, 1.01, 3)).toBe(false);
    expect(canSubmit(2.9, 0, 0.2, 3)).toBe(false);
  });

  it('counts the queued work, not only the spend', () => {
    expect(canSubmit(0, 2.9, 0.2, 3)).toBe(false);
  });

  it('refuses everything under a zero cap', () => {
    expect(canSubmit(0, 0, 0.001, 0)).toBe(false);
  });
});

describe('queuedEstimateUsd', () => {
  it('prices the queued parses, embeddings and scores with the margin', () => {
    const unit = { parse: 0.01, embedding: 0.001, score: 0.1 };
    expect(
      queuedEstimateUsd({ unparsed: 2, unembedded: 3, unscored: 4 }, unit, 2),
    ).toBeCloseTo((2 * 0.011 + 3 * 0.001 + 4 * 0.1) * 2, 10);
    expect(
      queuedEstimateUsd({ unparsed: 0, unembedded: 0, unscored: 0 }, unit, 2),
    ).toBe(0);
  });
});
