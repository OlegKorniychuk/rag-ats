import { Injectable, Logger } from '@nestjs/common';
import type { RetrievedChunk } from '@rag-ats/shared';
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
import {
  APPLICATION_SCORE_RAG_SYSTEM_PROMPT,
  applicationScoreRagUserPrompt,
  indexEvidence,
  type CriterionEvidence,
} from './prompts/application-score-rag.prompt.js';
import { buildGithubBlock } from './prompts/cv-profile.prompt.js';
import { normaliseText } from './cv-profile-parser.js';
import type { GithubSnapshot } from '../github/github-snapshot.js';
import { computeOverall } from '../scoring/compute-overall.js';
import {
  cvUnits,
  githubUnits,
  type EvidenceUnit,
} from '../scoring/evidence-units.js';
import {
  MAX_QUOTES_PER_CRITERION,
  resolveCitations,
} from '../scoring/resolve-citations.js';

export { MAX_QUOTES_PER_CRITERION };
export const MAX_QUOTE_CHARS = 300;
/** Appended to the reasoning of a criterion whose score was set to 0 for lack of evidence. */
export const ZEROED_NOTE = ' (Score set to 0: no evidence was cited.)';

export class LlmScoreError extends Error {
  constructor(message = 'The model could not score the application') {
    super(message);
    this.name = 'LlmScoreError';
  }
}

/** The model's citations could not be tied to evidence units, even after a retry. */
export class LlmGroundingError extends LlmScoreError {
  /**
   * The last attempt's citation problems (capped, see `capProblems`). They can
   * echo model output: for the database row only, never for logs or the API.
   */
  constructor(
    readonly problems: readonly string[] = [],
    message = 'Could not ground the score in the CV',
  ) {
    super(message);
    this.name = 'LlmGroundingError';
  }
}

export const MAX_GROUNDING_PROBLEMS = 20;
export const MAX_GROUNDING_PROBLEM_CHARS = 500;

/** Bounds what is stored about a grounding failure. */
export function capProblems(problems: readonly string[]): string[] {
  return problems
    .slice(0, MAX_GROUNDING_PROBLEMS)
    .map((problem) => problem.slice(0, MAX_GROUNDING_PROBLEM_CHARS));
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
  /** `rag` mode: the chunks the criterion was scored from; null in full text. */
  retrieved: RetrievedChunk[] | null;
}

export interface ApplicationScoreResult {
  criteria: ScoredCriterion[];
  rationale: string;
  overall: number;
  usage: { inputTokens: number; outputTokens: number; model: string };
  /** Model calls the successful result took: 1, or 2 after a grounding retry. */
  attempts: 1 | 2;
  /**
   * Criterion ids whose score above 0 was set to 0 because the model cited no
   * evidence even after the retry. Not stored: the reasoning carries a note.
   */
  zeroedCriteria: string[];
}

function unitEntry(unit: EvidenceUnit): [string, EvidenceUnit] {
  return [unit.id, unit];
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
    const cvUnitList = cvUnits(cv);
    const githubUnitList = githubBlock ? githubUnits(githubBlock) : null;

    return this.runAttempts({
      criteria,
      system: APPLICATION_SCORE_SYSTEM_PROMPT,
      userPrompt: (feedback) =>
        applicationScoreUserPrompt(
          criteria,
          cvUnitList,
          githubUnitList,
          feedback,
        ),
      units: new Map([...cvUnitList, ...(githubUnitList ?? [])].map(unitEntry)),
      retrievedFor: () => null,
    });
  }

  /**
   * RAG mode: each criterion is scored from the chunks retrieved for it
   * (`evidence`, best first), but it may cite a unit from any chunk retrieved
   * for the application, never from unretrieved text.
   */
  async scoreRag(params: {
    criteria: ScoringCriterion[];
    evidence: CriterionEvidence[];
  }): Promise<ApplicationScoreResult> {
    const { criteria, evidence } = params;
    const chunksById = new Map(evidence.map((e) => [e.criterionId, e.chunks]));
    // The prompt indexes the same evidence the same way, so the ids it shows
    // are exactly the ones in this map.
    const { units } = indexEvidence(evidence);

    return this.runAttempts({
      criteria,
      system: APPLICATION_SCORE_RAG_SYSTEM_PROMPT,
      userPrompt: (feedback) =>
        applicationScoreRagUserPrompt(criteria, evidence, feedback),
      units: new Map(units.map(unitEntry)),
      retrievedFor: (id) => chunksById.get(id) ?? [],
    });
  }

  /**
   * Shared by both modes: call → normalise → resolve citations → retry once →
   * assemble. A score above 0 citing nothing is a problem on the first attempt
   * (retry with feedback) and is set to 0 on the second.
   */
  private async runAttempts(params: {
    criteria: ScoringCriterion[];
    system: string;
    userPrompt: (feedback: string[] | null) => string;
    units: ReadonlyMap<string, EvidenceUnit>;
    retrievedFor: (criterionId: string) => RetrievedChunk[] | null;
  }): Promise<ApplicationScoreResult> {
    const { criteria, system, userPrompt, units, retrievedFor } = params;
    const expectedIds = criteria.map((c) => c.id);

    const usage = { inputTokens: 0, outputTokens: 0, model: this.llm.model };
    let feedback: string[] | null = null;

    for (const attempt of [1, 2] as const) {
      const output = await this.callModel(system, userPrompt(feedback), usage);
      const normalised: ApplicationScoreOutput = {
        rationale: output.rationale.trim(),
        criteria: output.criteria.map((c) => ({
          criterionId: c.criterionId.trim(),
          score: clampScore(c.score),
          reasoning: c.reasoning.trim(),
          evidence: c.evidence,
        })),
      };

      const check = resolveCitations(normalised, units, expectedIds, {
        zeroUnsupported: attempt === 2,
      });
      if (!check.valid) {
        this.logger.warn(
          `Score attempt ${attempt} failed citation check: problems=${check.problems.length} (details stored on the score row when the score fails)`,
        );
        feedback = check.problems;
        continue;
      }

      const byId = new Map(normalised.criteria.map((c) => [c.criterionId, c]));
      const resolvedById = new Map(
        check.criteria.map((c) => [c.criterionId, c]),
      );
      const zeroed = new Set(check.zeroed);
      const scored: ScoredCriterion[] = criteria.map((input) => {
        const c = byId.get(input.id)!;
        const resolved = resolvedById.get(input.id)!;
        return {
          criterionId: input.id,
          criterion: input.text,
          importance: input.importance,
          score: resolved.score,
          reasoning: zeroed.has(input.id)
            ? `${c.reasoning}${ZEROED_NOTE}`.trim()
            : c.reasoning,
          // Units are already capped; this is defence in depth.
          quotes: resolved.quotes.map((q) => ({
            source: q.source,
            text: q.text.slice(0, MAX_QUOTE_CHARS),
          })),
          retrieved: retrievedFor(input.id),
        };
      });
      return {
        criteria: scored,
        rationale: normalised.rationale,
        overall: computeOverall(scored),
        usage,
        attempts: attempt,
        zeroedCriteria: check.zeroed,
      };
    }

    // `feedback` holds the last attempt's problems here.
    throw new LlmGroundingError(capProblems(feedback ?? []));
  }

  private async callModel(
    system: string,
    user: string,
    usage: { inputTokens: number; outputTokens: number; model: string },
  ): Promise<ApplicationScoreOutput> {
    let result;
    try {
      result = await this.llm.parseStructured({
        system,
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
