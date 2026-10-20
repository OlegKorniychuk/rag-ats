import type { ApplicationScore } from '@rag-ats/shared';

export const SCORE_POLL_INTERVAL_MS = 3000;

export type ScoreBand = 'success' | 'warning' | 'error';

export function scoreBand(overall: number): ScoreBand {
  if (overall >= 75) return 'success';
  if (overall >= 50) return 'warning';
  return 'error';
}

export const isScoreInFlight = (score: ApplicationScore): boolean =>
  score.status === 'pending' || score.status === 'scoring';

export const hasScoreInFlight = (
  applications: readonly { score: ApplicationScore }[] | undefined,
): boolean =>
  applications?.some((application) => isScoreInFlight(application.score)) ??
  false;
