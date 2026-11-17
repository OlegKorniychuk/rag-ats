import { SeedMeter } from './metering.js';

const usage = (inputTokens: number, outputTokens: number) => ({
  model: 'm',
  inputTokens,
  outputTokens,
  totalTokens: inputTokens + outputTokens,
});

describe('SeedMeter', () => {
  const pricing = { inputPerMillion: 1, outputPerMillion: 4 };

  it('prices chat usage and embeddings', () => {
    const meter = new SeedMeter(pricing);
    meter.recordCall('cv_profile');
    meter.recordUsage('cv_profile', usage(1_000_000, 500_000));
    meter.recordEmbedding(usage(1_000_000, 0));
    expect(meter.chatCostUsd).toBeCloseTo(1 + 2, 10);
    expect(meter.embeddingCostUsd).toBeCloseTo(0.02, 10);
    expect(meter.spentUsd).toBeCloseTo(3.02, 10);
  });

  it('counts calls per schema, including ones without usage', () => {
    const meter = new SeedMeter(pricing);
    meter.recordCall('cv_profile');
    meter.recordCall('cv_profile');
    meter.recordCall('application_score');
    meter.recordUsage('cv_profile', null);
    expect(meter.calls('cv_profile')).toBe(2);
    expect(meter.calls('application_score')).toBe(1);
    expect(meter.calls('nope')).toBe(0);
    expect(meter.chatCalls).toBe(3);
    expect(meter.spentUsd).toBe(0);
  });
});
