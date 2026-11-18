/**
 * Buckets for the problems of a grounding failure (`LlmGroundingError.problems`,
 * produced by `scoring/verify-quotes.ts`), like the table in
 * `docs/eval/synthetic-data.md` ("Score failures").
 */
import type { ScoreJobRecord } from './score-record.js';

export const GROUNDING_BUCKETS = [
  'scored-without-quote',
  'quote-not-found-cv',
  'quote-not-found-github',
  'github-not-provided',
  'quote-too-short',
  'unknown-criterion',
  'missing-criterion',
  'duplicate-criterion',
  'no-quotes',
  'other',
] as const;

export type GroundingBucket = (typeof GROUNDING_BUCKETS)[number];

/** Pattern per bucket, matching the exact wording of `verifyQuotes`. */
const RULES: ReadonlyArray<[GroundingBucket, RegExp]> = [
  ['unknown-criterion', /^Unknown criterion id /],
  ['duplicate-criterion', /^Criterion \S+ appears more than once$/],
  ['scored-without-quote', /^Criterion \S+ has a score above 0 but no quotes$/],
  [
    'quote-too-short',
    /^Criterion \S+: quote .* is shorter than \d+ characters$/s,
  ],
  [
    'github-not-provided',
    /^Criterion \S+: quote .* cites github, but no <github> data was provided$/s,
  ],
  [
    'quote-not-found-github',
    /^Criterion \S+: quote .* is not a verbatim excerpt of <github>$/s,
  ],
  [
    'quote-not-found-cv',
    /^Criterion \S+: quote .* is not a verbatim excerpt of <cv>$/s,
  ],
  ['missing-criterion', /^Criterion \S+ is missing$/],
  ['no-quotes', /^The response contains no quotes$/],
];

/**
 * The bucket of one problem string. (The 500-character cap on stored problems
 * never bites: a quote preview is at most 80 characters.)
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
