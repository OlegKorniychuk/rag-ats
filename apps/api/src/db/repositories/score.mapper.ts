import type {
  ApplicationScore,
  ParseStatus,
  ScoreResult,
  ScoreStatus,
} from '@rag-ats/shared';

/** The columns of an `application_scores` row the API shape is derived from. */
export interface ScoreRow {
  status: ScoreStatus;
  error: string | null;
  result: ScoreResult | null;
  cvDocumentId: string | null;
  criteriaHash: string | null;
}

/** What the score is compared against to decide `waitingForParse` / `stale`. */
export interface ScoreContext {
  candidateParseStatus: ParseStatus;
  candidateParsedCvDocumentId: string | null;
  /**
   * Hash of the vacancy's CURRENT title + requirements (not of the stored
   * criteria), so an edit marks scores stale before anything is re-extracted.
   */
  vacancyCriteriaHash: string;
}

/**
 * Maps a score row to the API shape, deriving `waitingForParse` and `stale`.
 * Internal columns (hashes, tokens, model/mode) never leave the repository;
 * `result` already carries everything the contract exposes. An application
 * without a score row reads as a plain `pending` one.
 */
export function toApplicationScore(
  row: ScoreRow | null | undefined,
  context: ScoreContext,
): ApplicationScore {
  const waitingForParse = context.candidateParseStatus !== 'parsed';
  if (!row) {
    return {
      status: 'pending',
      error: null,
      waitingForParse,
      stale: false,
      result: null,
    };
  }
  const stale =
    row.result !== null &&
    (row.status !== 'scored' ||
      row.cvDocumentId !== context.candidateParsedCvDocumentId ||
      row.criteriaHash !== context.vacancyCriteriaHash);
  return {
    status: row.status,
    error: row.error,
    waitingForParse,
    stale,
    result: row.result,
  };
}
