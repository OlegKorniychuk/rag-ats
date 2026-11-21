import { Injectable, Logger } from '@nestjs/common';
import type { InterviewQuestion, ScoreResult } from '@rag-ats/shared';
import OpenAI from 'openai';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { citedUnitIds } from '../scoring/cited-unit-ids.js';
import {
  cvUnits,
  githubUnits,
  type EvidenceUnit,
} from '../scoring/evidence-units.js';
import { resolveQuestionCitations } from '../scoring/resolve-question-citations.js';
import { capProblems } from './application-scorer.js';
import { normaliseText } from './cv-profile-parser.js';
import {
  INTERVIEW_QUESTIONS_SCHEMA_NAME,
  interviewQuestionsSchema,
  type InterviewQuestionsOutput,
} from './interview-questions.schema.js';
import { LlmClient, type LlmUsage } from './llm-client.js';
import { buildGithubBlock } from './prompts/cv-profile.prompt.js';
import {
  INTERVIEW_QUESTIONS_SYSTEM_PROMPT,
  interviewQuestionsUserPrompt,
  type PromptQuestionCriterion,
} from './prompts/interview-questions.prompt.js';

/** A generation failure whose message is safe to store and show as-is. */
export class LlmQuestionError extends Error {
  constructor(message = 'The model could not generate questions') {
    super(message);
    this.name = 'LlmQuestionError';
  }
}

/** The model's citations could not be resolved, even after a retry. */
export class LlmQuestionGroundingError extends LlmQuestionError {
  /**
   * The last attempt's problems (capped). They can echo model output: for the
   * database row only, never for logs or the API.
   */
  constructor(readonly problems: readonly string[] = []) {
    super('The model cited evidence that could not be resolved');
    this.name = 'LlmQuestionGroundingError';
  }
}

export interface QuestionGenerationResult {
  questions: InterviewQuestion[];
  usage: { inputTokens: number; outputTokens: number; model: string };
  /** Model calls the result took: 1, or 2 after a grounding retry. */
  attempts: 1 | 2;
}

/**
 * Generates interview questions from an application's fit score: the scored
 * criteria (with the units the score cited) and the same evidence units the
 * scorer used. Cited IDs are resolved to verbatim text; one feedback retry.
 */
@Injectable()
export class QuestionGenerator {
  private readonly logger = new Logger(QuestionGenerator.name);

  constructor(private readonly llm: LlmClient) {}

  async generate(params: {
    vacancy: { title: string; requirements: string };
    score: ScoreResult;
    cvText: string;
    github?: GithubSnapshot | null;
  }): Promise<QuestionGenerationResult> {
    const cv = cvUnits(normaliseText(params.cvText));
    const github =
      params.github?.status === 'ok'
        ? githubUnits(buildGithubBlock(params.github))
        : null;
    const allUnits = [...cv, ...(github ?? [])];
    const units = new Map<string, EvidenceUnit>(allUnits.map((u) => [u.id, u]));
    const criteria: PromptQuestionCriterion[] = params.score.criteria.map(
      (c) => ({
        id: c.criterionId,
        text: c.criterion,
        importance: c.importance,
        score: c.score,
        citedIds: citedUnitIds(c.quotes, allUnits),
      }),
    );

    const usage = { inputTokens: 0, outputTokens: 0, model: this.llm.model };
    let feedback: string[] | null = null;
    for (const attempt of [1, 2] as const) {
      const output = await this.callModel(
        interviewQuestionsUserPrompt({
          vacancy: params.vacancy,
          criteria,
          cv,
          github,
          feedback,
        }),
        usage,
      );
      const check = resolveQuestionCitations(output, units, criteria);
      if (check.valid) {
        return { questions: check.questions, usage, attempts: attempt };
      }
      this.logger.warn(
        `Questions attempt ${attempt} failed citation check: problems=${check.problems.length} (details stored on the questions row when generation fails)`,
      );
      feedback = check.problems;
    }
    throw new LlmQuestionGroundingError(capProblems(feedback ?? []));
  }

  private async callModel(
    user: string,
    usage: { inputTokens: number; outputTokens: number; model: string },
  ): Promise<InterviewQuestionsOutput> {
    let result;
    try {
      result = await this.llm.parseStructured({
        system: INTERVIEW_QUESTIONS_SYSTEM_PROMPT,
        user,
        schema: interviewQuestionsSchema,
        schemaName: INTERVIEW_QUESTIONS_SCHEMA_NAME,
      });
    } catch (err) {
      // API/connection errors (already retried by the SDK) propagate as-is;
      // anything else means the output could not be parsed.
      if (err instanceof OpenAI.APIError) throw err;
      throw new LlmQuestionError();
    }
    this.recordUsage(result.usage, usage);
    if (result.kind !== 'parsed') throw new LlmQuestionError();
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
