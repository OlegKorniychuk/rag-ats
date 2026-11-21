import type {
  ApplicationQuestions,
  QuestionSet,
  QuestionStatus,
} from '@rag-ats/shared';

/** The columns of an `interview_questions` row the API shape is derived from. */
export interface QuestionRow {
  status: QuestionStatus;
  error: string | null;
  result: QuestionSet | null;
  cvDocumentId: string | null;
  criteriaHash: string | null;
  scoreScoredAt: Date | null;
}

/** What the stored set is compared against to decide `stale`. */
export interface QuestionContext {
  /** When the application's current score was computed, if it was. */
  scoreScoredAt: Date | null;
  candidateParsedCvDocumentId: string | null;
  /** Hash of the vacancy's CURRENT title + requirements. */
  vacancyCriteriaHash: string | null;
}

/**
 * Maps a questions row to the API shape, deriving `stale`: the stored set was
 * generated from another CV, criteria or score, or a regeneration is under
 * way. No row means questions were never requested (`status: null`).
 * Internal columns (failure details, tokens, hashes) never leave this mapper.
 */
export function toApplicationQuestions(
  row: QuestionRow | null | undefined,
  context: QuestionContext,
): ApplicationQuestions {
  if (!row) {
    return { status: null, error: null, stale: false, result: null };
  }
  const stale =
    row.result !== null &&
    (row.status !== 'ready' ||
      row.cvDocumentId !== context.candidateParsedCvDocumentId ||
      row.criteriaHash !== context.vacancyCriteriaHash ||
      row.scoreScoredAt?.getTime() !== context.scoreScoredAt?.getTime());
  return {
    status: row.status,
    error: row.error,
    stale,
    result: row.result,
  };
}
