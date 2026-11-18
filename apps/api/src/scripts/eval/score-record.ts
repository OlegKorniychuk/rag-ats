/** What the scoring eval records per job, and how a job is keyed. */
import type { ScoringMode } from '@rag-ats/shared';
import { pairKey } from './sample.js';
import type { SampledPair } from './sample.js';

export type { ScoringMode };

export const SCORING_MODES: readonly ScoringMode[] = ['full_text', 'rag'];

/** A pair scored in one mode; run 2 exists only for the noise subset. */
export interface ScoreJob {
  pair: SampledPair;
  mode: ScoringMode;
  run: 1 | 2;
}

export const jobKey = (job: ScoreJob): string =>
  `${pairKey(job.pair)}|${job.mode}|${job.run}`;

export interface RecordedQuote {
  source: 'cv' | 'github';
  text: string;
}

export interface RecordedCriterion {
  id: string;
  text: string;
  importance: 'must' | 'nice';
  score: number;
  reasoning: string;
  quotes: RecordedQuote[];
}

/**
 * grounding: `LlmGroundingError` (quotes still unverified after the in-job
 * retry); api: an OpenAI/network error; parse: any other `LlmScoreError`.
 */
export type FailureKind = 'grounding' | 'api' | 'parse';

export interface ScoreFailure {
  kind: FailureKind;
  /** Grounding only: the last attempt's verification problems. */
  problems?: string[];
  message: string;
}

interface RecordBase {
  /** `jobKey` of the job. */
  key: string;
  vacancyId: string;
  personaId: string;
  mode: ScoringMode;
  run: 1 | 2;
  /** ISO time the job finished. */
  at: string;
}

export interface ScoreOkRecord extends RecordBase {
  status: 'ok';
  overall: number;
  criteria: RecordedCriterion[];
  /** Model calls the score took: 1, or 2 after a grounding retry. */
  attempts: 1 | 2;
  inputTokens: number;
  outputTokens: number;
  /** Chat cost of the score at the pricing in force (embeddings not included). */
  costUsd: number;
}

export interface ScoreFailedRecord extends RecordBase {
  status: 'failed';
  failure: ScoreFailure;
}

/** One line of the cache. */
export type ScoreJobRecord = ScoreOkRecord | ScoreFailedRecord;
