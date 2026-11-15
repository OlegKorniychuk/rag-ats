import type { ParseStatus, ScoreStatus } from '@rag-ats/shared';
import type { QueuedWork } from './budget.js';

/** The seeded part of the DB at one moment; what the drain polls and the report counts. */
export interface CandidateRow {
  id: string;
  email: string;
  parseStatus: ParseStatus;
  parseError: string | null;
  parsedCvDocumentId: string | null;
  embeddedCvDocumentId: string | null;
}

export interface ScoreRow {
  applicationId: string;
  candidateId: string;
  vacancyTitle: string;
  status: ScoreStatus;
  error: string | null;
}

export interface SeedSnapshot {
  candidates: CandidateRow[];
  scores: ScoreRow[];
}

const parseTerminal = (c: CandidateRow): boolean =>
  c.parseStatus === 'parsed' || c.parseStatus === 'failed';

export const isEmbedded = (c: CandidateRow): boolean =>
  c.parsedCvDocumentId !== null &&
  c.embeddedCvDocumentId === c.parsedCvDocumentId;

/**
 * Everything the seed started has settled: every candidate is `parsed` or
 * `failed`, every parsed one is embedded, and every score is `scored` or
 * `failed`. Scores of a candidate whose parse failed stay `pending` for good
 * (nothing scores without a profile), so they don't hold the drain.
 */
export function isDrained(snapshot: SeedSnapshot): boolean {
  const failedParse = new Set(
    snapshot.candidates
      .filter((c) => c.parseStatus === 'failed')
      .map((c) => c.id),
  );
  if (!snapshot.candidates.every(parseTerminal)) return false;
  if (
    !snapshot.candidates
      .filter((c) => c.parseStatus === 'parsed')
      .every(isEmbedded)
  ) {
    return false;
  }
  return snapshot.scores
    .filter((s) => !failedParse.has(s.candidateId))
    .every((s) => s.status === 'scored' || s.status === 'failed');
}

export interface SnapshotCounts {
  candidates: number;
  parsed: number;
  failedParses: number;
  /** Candidates still `pending` / `parsing`. */
  parsePending: number;
  embedded: number;
  applications: number;
  scored: number;
  failedScores: number;
  /** Scores neither `scored` nor `failed` (still waiting, or blocked by a failed parse). */
  scoresPending: number;
}

export function summarize(snapshot: SeedSnapshot): SnapshotCounts {
  const count = <T>(items: T[], pred: (item: T) => boolean) =>
    items.filter(pred).length;
  const { candidates, scores } = snapshot;
  const scored = count(scores, (s) => s.status === 'scored');
  const failedScores = count(scores, (s) => s.status === 'failed');
  return {
    candidates: candidates.length,
    parsed: count(candidates, (c) => c.parseStatus === 'parsed'),
    failedParses: count(candidates, (c) => c.parseStatus === 'failed'),
    parsePending: count(candidates, (c) => !parseTerminal(c)),
    embedded: count(
      candidates,
      (c) => c.parseStatus === 'parsed' && isEmbedded(c),
    ),
    applications: scores.length,
    scored,
    failedScores,
    scoresPending: scores.length - scored - failedScores,
  };
}

export function progressLine(counts: SnapshotCounts): string {
  return (
    `parsed ${counts.parsed}/${counts.candidates} (failed ${counts.failedParses}), ` +
    `embedded ${counts.embedded}, scored ${counts.scored}/${counts.applications} ` +
    `(failed ${counts.failedScores})`
  );
}

/** What the snapshot still has to spend on (see `queuedEstimateUsd`). */
export function queuedWork(snapshot: SeedSnapshot): QueuedWork {
  const failedParse = new Set(
    snapshot.candidates
      .filter((c) => c.parseStatus === 'failed')
      .map((c) => c.id),
  );
  return {
    unparsed: snapshot.candidates.filter((c) => !parseTerminal(c)).length,
    unembedded: snapshot.candidates.filter(
      (c) => c.parseStatus === 'parsed' && !isEmbedded(c),
    ).length,
    unscored: snapshot.scores.filter(
      (s) =>
        !failedParse.has(s.candidateId) &&
        s.status !== 'scored' &&
        s.status !== 'failed',
    ).length,
  };
}
