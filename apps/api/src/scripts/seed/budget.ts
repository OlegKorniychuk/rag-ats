/**
 * May the seed submit more work? Spend so far, plus the estimated cost of work
 * already submitted but not finished, plus the next submission's estimate,
 * must stay within the cap.
 */
export function canSubmit(
  spentUsd: number,
  queuedEstimateUsd: number,
  nextEstimateUsd: number,
  capUsd: number,
): boolean {
  return spentUsd + queuedEstimateUsd + nextEstimateUsd <= capUsd;
}

/** What is still to be spent on candidates and scores the seed has already submitted. */
export interface QueuedWork {
  /** Candidates not yet `parsed` or `failed`: a parse and an embedding to come. */
  unparsed: number;
  /** Parsed candidates whose chunks are not built yet. */
  unembedded: number;
  /** Scores not yet `scored` or `failed` whose candidate has not failed to parse. */
  unscored: number;
}

/**
 * Estimated USD of the queued work. Measured from the DB rather than as
 * "submitted minus spent", which would keep the margin of finished work as a
 * phantom backlog and stop the seed early.
 */
export function queuedEstimateUsd(
  work: QueuedWork,
  unit: { parse: number; embedding: number; score: number },
  margin: number,
): number {
  return (
    (work.unparsed * (unit.parse + unit.embedding) +
      work.unembedded * unit.embedding +
      work.unscored * unit.score) *
    margin
  );
}
