import { UsageMeter } from './meter.js';

const usage = (i: number, o: number) => ({
  model: 'm',
  inputTokens: i,
  outputTokens: o,
  totalTokens: i + o,
});

describe('UsageMeter', () => {
  it('counts calls and sums usage until reset', () => {
    const meter = new UsageMeter();
    expect(meter.usage).toBeNull();
    meter.recordCall();
    meter.recordUsage(usage(100, 10));
    meter.recordCall();
    meter.recordUsage(usage(120, 20));
    expect(meter.attempts).toBe(2);
    expect(meter.usage).toEqual(usage(220, 30));
    meter.reset();
    expect(meter.attempts).toBe(0);
    expect(meter.usage).toBeNull();
  });

  it('counts a call that reported no usage', () => {
    const meter = new UsageMeter();
    meter.recordCall();
    meter.recordUsage(null);
    expect(meter.attempts).toBe(1);
    expect(meter.usage).toBeNull();
  });
});
