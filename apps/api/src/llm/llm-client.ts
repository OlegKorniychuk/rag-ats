import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { EnvConfig } from '../config/env.config.js';
import { EMBEDDING_DIMENSIONS } from './embedding.constants.js';

/** Max inputs per embeddings request. */
export const EMBEDDING_BATCH_SIZE = 100;

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ParseStructuredParams<S extends z.ZodType> {
  system: string;
  user: string;
  schema: S;
  schemaName: string;
}

export interface EmbedResult {
  vectors: number[][];
  usage: LlmUsage | null;
}

export type ParseStructuredResult<T> =
  | { kind: 'parsed'; parsed: T; usage: LlmUsage | null }
  | { kind: 'refusal'; refusal: string; usage: LlmUsage | null }
  | { kind: 'empty'; usage: LlmUsage | null };

/**
 * Thin wrapper over a single OpenAI client. SDK errors (after its built-in
 * retries on 429/5xx/connection errors) propagate untouched.
 */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly client: OpenAI;
  public readonly model: string;
  public readonly embeddingModel: string;

  constructor(config: EnvConfig) {
    this.model = config.OPENAI_MODEL;
    this.embeddingModel = config.OPENAI_EMBEDDING_MODEL;
    this.client = new OpenAI({
      apiKey: config.OPENAI_API_KEY,
      maxRetries: 2,
      timeout: 60_000,
    });
  }

  async parseStructured<S extends z.ZodType>(
    params: ParseStructuredParams<S>,
  ): Promise<ParseStructuredResult<z.infer<S>>> {
    const response = await this.client.responses.parse({
      model: this.model,
      input: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
      text: { format: zodTextFormat(params.schema, params.schemaName) },
    });

    const usage: LlmUsage | null = response.usage
      ? {
          model: response.model ?? this.model,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : null;

    for (const item of response.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content) {
        if (part.type === 'refusal') {
          return { kind: 'refusal', refusal: part.refusal, usage };
        }
      }
    }

    if (response.output_parsed == null) return { kind: 'empty', usage };
    return {
      kind: 'parsed',
      parsed: response.output_parsed as z.infer<S>,
      usage,
    };
  }

  /**
   * Embeds `texts` in batches of EMBEDDING_BATCH_SIZE; vectors keep the input
   * order. Throws if the model returns a vector of an unexpected size.
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) return { vectors: [], usage: null };

    const vectors: number[][] = [];
    let inputTokens = 0;
    let totalTokens = 0;
    let model = this.embeddingModel;

    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
      const response = await this.client.embeddings.create({
        model: this.embeddingModel,
        input: batch,
      });

      if (response.data.length !== batch.length) {
        throw new Error(
          `Embeddings response has ${response.data.length} vectors for ${batch.length} inputs`,
        );
      }
      const ordered = [...response.data].sort((a, b) => a.index - b.index);
      for (const item of ordered) {
        if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding has ${item.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
        vectors.push(item.embedding);
      }

      model = response.model ?? model;
      inputTokens += response.usage?.prompt_tokens ?? 0;
      totalTokens += response.usage?.total_tokens ?? 0;
    }

    const usage: LlmUsage = {
      model,
      inputTokens,
      outputTokens: 0,
      totalTokens,
    };
    this.logger.log(
      `LLM usage: model=${usage.model} input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens} total_tokens=${usage.totalTokens}`,
    );
    return { vectors, usage };
  }
}
