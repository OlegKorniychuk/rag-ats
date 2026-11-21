/**
 * Buckets for the problems of a grounding failure (`LlmGroundingError.problems`,
 * produced by `scoring/resolve-citations.ts`), like the table in
 * `docs/eval/synthetic-data.md` ("Score failures").
 */
import type { ScoreJobRecord } from './score-record.js';

export const GROUNDING_BUCKETS = [
  'unknown-evidence-id',
  'unknown-criterion',
  'missing-criterion',
  'duplicate-criterion',
  'other',
] as const;

export type GroundingBucket = (typeof GROUNDING_BUCKETS)[number];

/** Pattern per bucket, matching the exact wording of `citationProblems`. */
const RULES: ReadonlyArray<[GroundingBucket, RegExp]> = [
  ['unknown-criterion', /^Unknown criterion id /],
  ['duplicate-criterion', /^Criterion \S+ appears more than once$/],
  ['unknown-evidence-id', /^Criterion \S+ cites unknown evidence id /],
  ['missing-criterion', /^Criterion \S+ is missing$/],
];

/**
 * The bucket of one problem string. (The 500-character cap on stored problems
 * never bites: an evidence id preview is at most 80 characters.)
 */
export function bucketProblem(problem: string): GroundingBucket {
  for (const [bucket, pattern] of RULES) {
    if (pattern.test(problem)) return bucket;
  }
  return 'other';
}

/** The distinct buckets of a failure's problems, in `GROUNDING_BUCKETS` order; `['other']` when there are none. */
export function bucketsOfProblems(
  problems: readonly string[],
): GroundingBucket[] {
  const found = new Set(problems.map(bucketProblem));
  if (found.size === 0) return ['other'];
  return GROUNDING_BUCKETS.filter((b) => found.has(b));
}

/**
 * Failed grounding jobs per bucket: a job counts once in every bucket it has
 * (a failure can mix causes, so the counts may add up to more than the jobs).
 */
export function groundingBucketCounts(
  records: readonly ScoreJobRecord[],
): Record<GroundingBucket, number> {
  const counts = Object.fromEntries(
    GROUNDING_BUCKETS.map((b) => [b, 0]),
  ) as Record<GroundingBucket, number>;
  for (const record of records) {
    if (record.status !== 'failed' || record.failure.kind !== 'grounding') {
      continue;
    }
    for (const bucket of bucketsOfProblems(record.failure.problems ?? [])) {
      counts[bucket]++;
    }
  }
  return counts;
}
