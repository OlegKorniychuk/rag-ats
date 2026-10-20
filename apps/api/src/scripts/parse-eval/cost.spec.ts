import { costUsd, DEFAULT_PRICING } from './cost.js';

const usage = (inputTokens: number, outputTokens: number) => ({
  model: 'gpt-5.4-mini',
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
});

describe('costUsd', () => {
  it('computes input and output cost per million tokens', () => {
    expect(
      costUsd(usage(1_000_000, 1_000_000), {
        inputPerMillion: 1,
        outputPerMillion: 2,
      }),
    ).toBeCloseTo(3);
  });

  it('scales down for small counts with the default pricing', () => {
    // 2000 * 0.75 / 1e6 + 500 * 4.5 / 1e6
    expect(costUsd(usage(2000, 500), DEFAULT_PRICING)).toBeCloseTo(0.00375);
  });

  it('returns 0 for null usage', () => {
    expect(costUsd(null, DEFAULT_PRICING)).toBe(0);
  });

  it('defaults to 0.75 / 4.50', () => {
    expect(DEFAULT_PRICING).toEqual({
      inputPerMillion: 0.75,
      outputPerMillion: 4.5,
    });
  });
});
