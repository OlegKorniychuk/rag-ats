import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { EnvConfig } from '../config/env.config.js';

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
  private readonly client: OpenAI;
  public readonly model: string;

  constructor(config: EnvConfig) {
    this.model = config.OPENAI_MODEL;
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
}
