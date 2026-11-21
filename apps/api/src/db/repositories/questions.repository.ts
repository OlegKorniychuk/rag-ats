import type {
  ApplicationQuestions,
  QuestionSet,
  QuestionStatus,
  ScoreResult,
  ScoreStatus,
} from '@rag-ats/shared';

/** The application's score as the questions worker sees it. */
export interface QuestionScoreState {
  status: ScoreStatus;
  result: ScoreResult | null;
  /** The CV the stored result was computed from. */
  cvDocumentId: string | null;
  /** The criteria hash the stored result was computed from. */
  criteriaHash: string | null;
  scoredAt: Date | null;
}

/** What the questions worker needs to decide whether and how to generate. */
export interface QuestionState {
  applicationId: string;
  /** Null: the application has no questions row. */
  status: QuestionStatus | null;
  vacancyTitle: string;
  vacancyRequirements: string;
  candidateId: string;
  candidateParsedCvDocumentId: string | null;
  /** Hash of the vacancy's CURRENT title + requirements. */
  vacancyCriteriaHash: string | null;
  /** Null: the application has no score row. */
  score: QuestionScoreState | null;
}

export interface SavedQuestions {
  result: QuestionSet;
  cvDocumentId: string;
  criteriaHash: string;
  /** `scored_at` of the score the questions were generated from. */
  scoreScoredAt: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export const QUESTIONS_REPOSITORY = Symbol('QUESTIONS_REPOSITORY');

export interface QuestionsRepository {
  /** Null when the application is gone. */
  findState(applicationId: string): Promise<QuestionState | null>;
  /** The API shape (derived `stale`); `status: null` when never requested. */
  findApplicationQuestions(
    applicationId: string,
  ): Promise<ApplicationQuestions>;
  /** Creates the row or moves it back to `pending`, clearing the error; the last result is kept. */
  resetToPending(applicationId: string): Promise<void>;
  /**
   * Atomically moves `pending`/`generating` to `generating`. Returns false,
   * changing nothing, for `ready`/`failed` or a missing row. `generating` is
   * allowed so a job recovered after a crash can re-run.
   */
  markGenerating(applicationId: string): Promise<boolean>;
  /** Stores the set and marks it `ready` (clearing the error and failure details). */
  saveResult(applicationId: string, saved: SavedQuestions): Promise<void>;
  /** `details` are internal (never exposed); the last result is kept. */
  markFailed(
    applicationId: string,
    error: string,
    details: readonly string[] | null,
  ): Promise<void>;
  /** Application ids with questions `pending` or `generating`. */
  findBacklog(): Promise<string[]>;
}
