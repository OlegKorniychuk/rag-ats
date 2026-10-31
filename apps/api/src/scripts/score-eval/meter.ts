import type { LlmUsage } from '../../llm/llm-client.js';

/**
 * Counts model calls and sums their usage between `reset()` calls. The script
 * feeds it from a wrapped `LlmClient.parseStructured`, so a scorer retry shows
 * up as a second call.
 */
export class UsageMeter {
  private calls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private totalTokens = 0;
  private model: string | null = null;
  private hasUsage = false;

  reset(): void {
    this.calls = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.totalTokens = 0;
    this.model = null;
    this.hasUsage = false;
  }

  recordCall(): void {
    this.calls += 1;
  }

  recordUsage(usage: LlmUsage | null): void {
    if (!usage) return;
    this.hasUsage = true;
    this.inputTokens += usage.inputTokens;
    this.outputTokens += usage.outputTokens;
    this.totalTokens += usage.totalTokens;
    this.model = usage.model;
  }

  get attempts(): number {
    return this.calls;
  }

  /** Summed usage, or null when no call reported any. */
  get usage(): LlmUsage | null {
    if (!this.hasUsage || this.model === null) return null;
    return {
      model: this.model,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.totalTokens,
    };
  }
}
