import type {
  ApplicationScore,
  ParseStatus,
  ScoreResult,
  ScoreStatus,
  VacancyCriterion,
} from '@rag-ats/shared';

/** What the scoring worker needs to decide whether and how to score. */
export interface ScoreState {
  applicationId: string;
  vacancyId: string;
  candidateId: string;
  status: ScoreStatus;
  candidateParseStatus: ParseStatus;
  /** The CV the candidate's current profile was parsed from, if any. */
  candidateParsedCvDocumentId: string | null;
  vacancyTitle: string;
  vacancyRequirements: string;
  /** Null until the criteria were extracted. */
  vacancyCriteria: VacancyCriterion[] | null;
  /** Hash of the title + requirements the criteria were extracted from. */
  vacancyCriteriaHash: string | null;
  /** The CV the stored result was computed from, if any. */
  scoreCvDocumentId: string | null;
  /** The criteria hash the stored result was computed from, if any. */
  scoreCriteriaHash: string | null;
}

export interface SavedScore {
  result: ScoreResult;
  cvDocumentId: string;
  criteriaHash: string;
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
}

export const SCORES_REPOSITORY = Symbol('SCORES_REPOSITORY');

export interface ScoresRepository {
  /** Inserts a `pending` row; a no-op when the application already has one. */
  createPending(applicationId: string): Promise<void>;
  findScoreState(applicationId: string): Promise<ScoreState | null>;
  /** The API shape of one application's score (derived `stale`/`waitingForParse`). */
  findApplicationScore(applicationId: string): Promise<ApplicationScore | null>;
  /**
   * Atomically moves `pending`/`failed`/`scoring` to `scoring` (clearing the
   * error). Returns false, changing nothing, when the score is already
   * `scored` (or missing): a newer job finished first and this one must stop.
   * `scoring` is allowed so a job recovered after a crash can re-run.
   */
  markScoring(applicationId: string): Promise<boolean>;
  /** Stores the result and marks the score `scored` (clearing the error). */
  saveResult(applicationId: string, saved: SavedScore): Promise<void>;
  markFailed(applicationId: string, error: string): Promise<void>;
  /** Back to `pending` with the error cleared; the last result is kept. */
  resetToPending(applicationId: string): Promise<void>;
  /**
   * Resets every score of the candidate's applications to `pending` (keeping
   * results, which become stale) and returns those application ids.
   */
  resetPendingForCandidate(candidateId: string): Promise<string[]>;
  /**
   * Resets the vacancy's scores whose `criteria_hash` differs from the given
   * one to `pending` (keeping results, which become stale) and returns those
   * application ids. Never-scored rows (null hash) and `failed` rows with an
   * old hash count as outdated; rows on the current hash are left alone.
   */
  resetOutdatedForVacancy(
    vacancyId: string,
    criteriaHash: string,
  ): Promise<string[]>;
  findPendingByVacancy(vacancyId: string): Promise<string[]>;
  /** `pending`/`scoring` scores whose candidate is `parsed`. */
  findBacklog(): Promise<string[]>;
}
