import type { ApplicationScore, ParseStatus } from '@rag-ats/shared';

export const SCORE_POLL_INTERVAL_MS = 3000;
// Slow background refresh of an open board with nothing in flight, so newly
// arrived applications show up without a reload.
export const BOARD_IDLE_POLL_INTERVAL_MS = 30_000;

export type ScoreBand = 'success' | 'warning' | 'error';

export function scoreBand(overall: number): ScoreBand {
  if (overall >= 75) return 'success';
  if (overall >= 50) return 'warning';
  return 'error';
}

export const isScoreInFlight = (score: ApplicationScore): boolean =>
  score.status === 'pending' || score.status === 'scoring';

/**
 * A score waiting on a CV whose parse failed can't progress until a recruiter
 * retries the parse, so it is not "in flight" (no polling, no spinner).
 */
export const isBlockedByFailedParse = (
  score: ApplicationScore,
  parseStatus: ParseStatus | undefined,
): boolean =>
  score.status === 'pending' &&
  score.waitingForParse &&
  parseStatus === 'failed';

export const hasScoreInFlight = (
  applications:
    | readonly {
        score: ApplicationScore;
        candidate: { parseStatus: ParseStatus };
      }[]
    | undefined,
): boolean =>
  applications?.some(
    ({ score, candidate }) =>
      isScoreInFlight(score) &&
      !isBlockedByFailedParse(score, candidate.parseStatus),
  ) ?? false;

export const isStaleInFlight = (score: ApplicationScore): boolean =>
  score.stale && isScoreInFlight(score);

export const isStaleSettled = (score: ApplicationScore): boolean =>
  score.stale && !isScoreInFlight(score);
