import type { z } from 'zod';
import type { EnvConfig } from '../../config/env.config.js';
import {
  LlmClient,
  type EmbedResult,
  type LlmUsage,
  type ParseStructuredParams,
  type ParseStructuredResult,
} from '../../llm/llm-client.js';
import { costUsd, type Pricing } from '../parse-eval/cost.js';

/** USD per 1M embedding tokens (`text-embedding-3-small`, third-party listed price). */
export const EMBEDDING_PRICE_PER_MILLION = 0.02;

export interface KindUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Sums the real usage of every LLM call, per structured-output schema name. */
export class SeedMeter {
  private readonly byKind = new Map<string, KindUsage>();
  private embeddingCalls = 0;
  private embeddingInput = 0;

  constructor(private readonly pricing: Pricing) {}

  private kind(name: string): KindUsage {
    let entry = this.byKind.get(name);
    if (!entry) {
      entry = { calls: 0, inputTokens: 0, outputTokens: 0 };
      this.byKind.set(name, entry);
    }
    return entry;
  }

  recordCall(schemaName: string): void {
    this.kind(schemaName).calls += 1;
  }

  recordUsage(schemaName: string, usage: LlmUsage | null): void {
    if (!usage) return;
    const entry = this.kind(schemaName);
    entry.inputTokens += usage.inputTokens;
    entry.outputTokens += usage.outputTokens;
  }

  recordEmbedding(usage: LlmUsage | null): void {
    this.embeddingCalls += 1;
    if (usage) this.embeddingInput += usage.inputTokens;
  }

  /** Calls made with this schema name (retries count as extra calls). */
  calls(schemaName: string): number {
    return this.byKind.get(schemaName)?.calls ?? 0;
  }

  get embeddingCallCount(): number {
    return this.embeddingCalls;
  }

  get embeddingTokens(): number {
    return this.embeddingInput;
  }

  get chatTokens(): { inputTokens: number; outputTokens: number } {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const e of this.byKind.values()) {
      inputTokens += e.inputTokens;
      outputTokens += e.outputTokens;
    }
    return { inputTokens, outputTokens };
  }

  get chatCalls(): number {
    return [...this.byKind.values()].reduce((n, e) => n + e.calls, 0);
  }

  get embeddingCostUsd(): number {
    return (this.embeddingInput * EMBEDDING_PRICE_PER_MILLION) / 1_000_000;
  }

  get chatCostUsd(): number {
    const { inputTokens, outputTokens } = this.chatTokens;
    return costUsd(
      { model: '', inputTokens, outputTokens, totalTokens: 0 },
      this.pricing,
    );
  }

  /** Chat plus embeddings, in USD at the configured pricing. */
  get spentUsd(): number {
    return this.chatCostUsd + this.embeddingCostUsd;
  }

  snapshot(): Record<string, KindUsage> {
    return Object.fromEntries(
      [...this.byKind.entries()].map(([k, v]) => [k, { ...v }]),
    );
  }
}

/**
 * The app's `LlmClient`, recording every call into a `SeedMeter`. Provided in
 * place of `LlmClient` (the seed's Nest context overrides that provider), so
 * the jobs, which inject `LlmClient`, are metered with no other change.
 */
export class MeteredLlmClient extends LlmClient {
  constructor(
    config: EnvConfig,
    private readonly meter: SeedMeter,
  ) {
    super(config);
  }

  override async parseStructured<S extends z.ZodType>(
    params: ParseStructuredParams<S>,
  ): Promise<ParseStructuredResult<z.infer<S>>> {
    this.meter.recordCall(params.schemaName);
    const result = await super.parseStructured(params);
    this.meter.recordUsage(params.schemaName, result.usage);
    return result;
  }

  override async embed(texts: string[]): Promise<EmbedResult> {
    const result = await super.embed(texts);
    this.meter.recordEmbedding(result.usage);
    return result;
  }
}
