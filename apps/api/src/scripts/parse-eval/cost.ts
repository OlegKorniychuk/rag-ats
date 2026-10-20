import type { LlmUsage } from '../../llm/llm-client.js';

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

// USD per 1M tokens for gpt-5.4-mini. These are third-party listed prices and
// are NOT verified against OpenAI's own pricing page; override with the
// --input-price / --output-price flags when the real figures are known.
export const DEFAULT_PRICING: Pricing = {
  inputPerMillion: 0.75,
  outputPerMillion: 4.5,
};

export const PRICING_CAVEAT =
  "Prices are third-party listed figures for gpt-5.4-mini, unverified against OpenAI's pricing page.";

/** Cost in USD of one call; a missing usage costs 0. */
export function costUsd(usage: LlmUsage | null, pricing: Pricing): number {
  if (!usage) return 0;
  return (
    (usage.inputTokens * pricing.inputPerMillion +
      usage.outputTokens * pricing.outputPerMillion) /
    1_000_000
  );
}
