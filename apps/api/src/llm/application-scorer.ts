import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmClient, type LlmUsage } from './llm-client.js';
import {
  APPLICATION_SCORE_SCHEMA_NAME,
  applicationScoreSchema,
  type ApplicationScoreOutput,
} from './application-score.schema.js';
import {
  APPLICATION_SCORE_SYSTEM_PROMPT,
  applicationScoreUserPrompt,
} from './prompts/application-score.prompt.js';
import { buildGithubBlock } from './prompts/cv-profile.prompt.js';
import { normaliseText } from './cv-profile-parser.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { computeOverall } from '../scoring/compute-overall.js';
import { verifyQuotes } from '../scoring/verify-quotes.js';

export const MAX_QUOTES_PER_CRITERION = 3;
export const MAX_QUOTE_CHARS = 300;

export class LlmScoreError extends Error {
  constructor(message = 'The model could not score the application') {
    super(message);
    this.name = 'LlmScoreError';
  }
}

/** The model's answer could not be tied to verbatim CV/GitHub text, even after a retry. */
export class LlmGroundingError extends LlmScoreError {
  constructor(message = 'Could not ground the score in the CV') {
    super(message);
    this.name = 'LlmGroundingError';
  }
}

export interface ScoringCriterion {
  id: string;
  text: string;
  importance: 'must' | 'nice';
}

export interface ScoredQuote {
  source: 'cv' | 'github';
  text: string;
}

export interface ScoredCriterion {
  criterionId: string;
  criterion: string;
  importance: 'must' | 'nice';
  score: number;
  reasoning: string;
  quotes: ScoredQuote[];
}

export interface ApplicationScoreResult {
  criteria: ScoredCriterion[];
  rationale: string;
  overall: number;
  usage: { inputTokens: number; outputTokens: number; model: string };
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

@Injectable()
export class ApplicationScorer {
  private readonly logger = new Logger(ApplicationScorer.name);

  constructor(private readonly llm: LlmClient) {}

  async score(params: {
    criteria: ScoringCriterion[];
    cvText: string;
    github?: GithubSnapshot | null;
  }): Promise<ApplicationScoreResult> {
    const { criteria } = params;
    const cv = normaliseText(params.cvText);
    const githubBlock =
      params.github?.status === 'ok' ? buildGithubBlock(params.github) : null;
    const expectedIds = criteria.map((c) => c.id);

    const usage = { inputTokens: 0, outputTokens: 0, model: this.llm.model };
    let feedback: string[] | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const output = await this.callModel(
        applicationScoreUserPrompt(criteria, cv, githubBlock, feedback),
        usage,
      );
      const normalised: ApplicationScoreOutput = {
        rationale: output.rationale.trim(),
        criteria: output.criteria.map((c) => ({
          criterionId: c.criterionId.trim(),
          score: clampScore(c.score),
          reasoning: c.reasoning.trim(),
          quotes: c.quotes.map((q) => ({
            source: q.source,
            text: q.text.trim(),
          })),
        })),
      };

      const check = verifyQuotes(
        normalised,
        { cv, github: githubBlock },
        expectedIds,
      );
      if (!check.valid) {
        this.logger.warn(
          `Score attempt ${attempt} failed quote verification: problems=${check.problems.length}`,
        );
        feedback = check.problems;
        continue;
      }

      const byId = new Map(normalised.criteria.map((c) => [c.criterionId, c]));
      const scored: ScoredCriterion[] = criteria.map((input) => {
        const c = byId.get(input.id)!;
        return {
          criterionId: input.id,
          criterion: input.text,
          importance: input.importance,
          score: c.score,
          reasoning: c.reasoning,
          // A prefix of a verbatim quote is still verbatim.
          quotes: c.quotes.slice(0, MAX_QUOTES_PER_CRITERION).map((q) => ({
            source: q.source,
            text: q.text.slice(0, MAX_QUOTE_CHARS),
          })),
        };
      });
      return {
        criteria: scored,
        rationale: normalised.rationale,
        overall: computeOverall(scored),
        usage,
      };
    }

    throw new LlmGroundingError();
  }

  private async callModel(
    user: string,
    usage: { inputTokens: number; outputTokens: number; model: string },
  ): Promise<ApplicationScoreOutput> {
    let result;
    try {
      result = await this.llm.parseStructured({
        system: APPLICATION_SCORE_SYSTEM_PROMPT,
        user,
        schema: applicationScoreSchema,
        schemaName: APPLICATION_SCORE_SCHEMA_NAME,
      });
    } catch (err) {
      // API/connection errors (already retried by the SDK) propagate as-is;
      // anything else means the output could not be parsed.
      if (err instanceof OpenAI.APIError) throw err;
      throw new LlmScoreError();
    }

    this.recordUsage(result.usage, usage);
    if (result.kind !== 'parsed') throw new LlmScoreError();
    return result.parsed;
  }

  private recordUsage(
    call: LlmUsage | null,
    total: { inputTokens: number; outputTokens: number; model: string },
  ): void {
    if (!call) return;
    total.inputTokens += call.inputTokens;
    total.outputTokens += call.outputTokens;
    total.model = call.model;
    this.logger.log(
      `LLM usage: model=${call.model} input_tokens=${call.inputTokens} output_tokens=${call.outputTokens} total_tokens=${call.totalTokens}`,
    );
  }
}
