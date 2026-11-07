import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmClient, type LlmUsage } from './llm-client.js';
import {
  VACANCY_CRITERIA_SCHEMA_NAME,
  vacancyCriteriaSchema,
} from './vacancy-criteria.schema.js';
import {
  VACANCY_CRITERIA_SYSTEM_PROMPT,
  vacancyCriteriaUserPrompt,
} from './prompts/vacancy-criteria.prompt.js';

export const MAX_CRITERIA = 15;

export type CriterionImportanceValue = 'must' | 'nice';

export interface VacancyCriterion {
  id: string;
  text: string;
  importance: CriterionImportanceValue;
}

export class LlmCriteriaError extends Error {
  constructor(
    message = 'The model could not extract criteria from the vacancy',
  ) {
    super(message);
    this.name = 'LlmCriteriaError';
  }
}

@Injectable()
export class CriteriaExtractor {
  private readonly logger = new Logger(CriteriaExtractor.name);

  constructor(private readonly llm: LlmClient) {}

  async extract(
    title: string,
    requirements: string,
  ): Promise<{ criteria: VacancyCriterion[]; usage: LlmUsage | null }> {
    let result;
    try {
      result = await this.llm.parseStructured({
        system: VACANCY_CRITERIA_SYSTEM_PROMPT,
        user: vacancyCriteriaUserPrompt(title.trim(), requirements.trim()),
        schema: vacancyCriteriaSchema,
        schemaName: VACANCY_CRITERIA_SCHEMA_NAME,
      });
    } catch (err) {
      // API/connection errors (already retried by the SDK) propagate as-is;
      // anything else means the output could not be parsed.
      if (err instanceof OpenAI.APIError) throw err;
      throw new LlmCriteriaError();
    }

    if (result.usage) {
      this.logger.log(
        `LLM usage: model=${result.usage.model} input_tokens=${result.usage.inputTokens} output_tokens=${result.usage.outputTokens} total_tokens=${result.usage.totalTokens}`,
      );
    }

    if (result.kind !== 'parsed') throw new LlmCriteriaError();

    const criteria = result.parsed.criteria
      .map((c) => ({ text: c.text.trim(), importance: c.importance }))
      .filter((c) => c.text.length > 0)
      .slice(0, MAX_CRITERIA)
      .map((c, i) => ({ id: `c${i + 1}`, ...c }));

    if (criteria.length === 0) throw new LlmCriteriaError();
    return { criteria, usage: result.usage };
  }
}
