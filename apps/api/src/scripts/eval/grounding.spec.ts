import { verifyQuotes } from '../../scoring/verify-quotes.js';
import {
  bucketProblem,
  bucketsOfProblems,
  groundingBucketCounts,
  type GroundingBucket,
} from './grounding.js';
import type { ScoreJobRecord } from './score-record.js';

const CV = 'Built payment services in Kotlin for five years at Acme.';
const GITHUB = 'Repo: seed-repo, a Rust service.';

/** The real problems `verifyQuotes` produces for one bad response. */
function problemsFor(
  criteria: Array<{
    criterionId: string;
    score: number;
    quotes: Array<{ source: 'cv' | 'github'; text: string }>;
  }>,
  expected: string[],
  github: string | null = GITHUB,
): string[] {
  return verifyQuotes({ criteria }, { cv: CV, github }, expected).problems;
}

describe('bucketProblem against the real verifyQuotes strings', () => {
  const cases: Array<[GroundingBucket, string[]]> = [
    [
      'scored-without-quote',
      problemsFor([{ criterionId: 'c1', score: 70, quotes: [] }], ['c1']),
    ],
    [
      'quote-not-found-cv',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 70,
            quotes: [{ source: 'cv', text: 'Led a team of forty engineers' }],
          },
        ],
        ['c1'],
      ),
    ],
    [
      'quote-not-found-github',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 70,
            quotes: [{ source: 'github', text: 'Repository: https://x.y' }],
          },
        ],
        ['c1'],
      ),
    ],
    [
      'github-not-provided',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 70,
            quotes: [{ source: 'github', text: 'Rust service' }],
          },
        ],
        ['c1'],
        null,
      ),
    ],
    [
      'quote-too-short',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 70,
            quotes: [{ source: 'cv', text: 'C' }],
          },
        ],
        ['c1'],
      ),
    ],
    [
      'unknown-criterion',
      problemsFor(
        [
          {
            criterionId: 'zzz',
            score: 0,
            quotes: [{ source: 'cv', text: 'Kotlin' }],
          },
          {
            criterionId: 'c1',
            score: 0,
            quotes: [{ source: 'cv', text: 'Kotlin' }],
          },
        ],
        ['c1'],
      ),
    ],
    [
      'missing-criterion',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 0,
            quotes: [{ source: 'cv', text: 'Kotlin' }],
          },
        ],
        ['c1', 'c2'],
      ),
    ],
    [
      'duplicate-criterion',
      problemsFor(
        [
          {
            criterionId: 'c1',
            score: 0,
            quotes: [{ source: 'cv', text: 'Kotlin' }],
          },
          {
            criterionId: 'c1',
            score: 0,
            quotes: [{ source: 'cv', text: 'Kotlin' }],
          },
        ],
        ['c1'],
      ),
    ],
    [
      'no-quotes',
      problemsFor([{ criterionId: 'c1', score: 0, quotes: [] }], ['c1']),
    ],
  ];

  it.each(cases)('%s', (bucket, problems) => {
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map(bucketProblem)).toContain(bucket);
    // and nothing in these single-cause responses falls into "other"
    expect(problems.map(bucketProblem)).not.toContain('other');
  });

  it('keeps the literal wording classified (guards a verifier rewording)', () => {
    expect(
      bucketProblem('Criterion c1 has a score above 0 but no quotes'),
    ).toBe('scored-without-quote');
    expect(
      bucketProblem(
        'Criterion c2: quote "x y" is not a verbatim excerpt of <cv>',
      ),
    ).toBe('quote-not-found-cv');
    expect(
      bucketProblem(
        'Criterion c2: quote "x y" is not a verbatim excerpt of <github>',
      ),
    ).toBe('quote-not-found-github');
    expect(
      bucketProblem('Criterion c2: quote "C" is shorter than 2 characters'),
    ).toBe('quote-too-short');
    expect(bucketProblem('Unknown criterion id "zzz"')).toBe(
      'unknown-criterion',
    );
    expect(bucketProblem('Criterion c3 is missing')).toBe('missing-criterion');
    expect(bucketProblem('Criterion c3 appears more than once')).toBe(
      'duplicate-criterion',
    );
    expect(bucketProblem('The response contains no quotes')).toBe('no-quotes');
  });

  it('puts anything unrecognised into other', () => {
    expect(bucketProblem('something new')).toBe('other');
  });
});

describe('bucketsOfProblems', () => {
  it('lists distinct buckets in a stable order', () => {
    expect(
      bucketsOfProblems([
        'Criterion c2: quote "x y" is not a verbatim excerpt of <cv>',
        'Criterion c1 has a score above 0 but no quotes',
        'Criterion c3: quote "q r" is not a verbatim excerpt of <cv>',
      ]),
    ).toEqual(['scored-without-quote', 'quote-not-found-cv']);
  });

  it('is other when there are no problems', () => {
    expect(bucketsOfProblems([])).toEqual(['other']);
  });
});

describe('groundingBucketCounts', () => {
  const failed = (
    kind: 'grounding' | 'api' | 'parse',
    problems?: string[],
  ): ScoreJobRecord => ({
    key: `k${Math.random()}`,
    vacancyId: 'v',
    personaId: 'p',
    mode: 'full_text',
    run: 1,
    at: '2026-01-01T00:00:00.000Z',
    status: 'failed',
    failure: { kind, problems, message: 'm' },
  });

  it('counts a job once per bucket and only grounding failures', () => {
    const counts = groundingBucketCounts([
      failed('grounding', [
        'Criterion c1 has a score above 0 but no quotes',
        'Criterion c2 has a score above 0 but no quotes',
        'Criterion c3: quote "ab" is not a verbatim excerpt of <cv>',
      ]),
      failed('grounding', ['Criterion c1 is missing']),
      failed('api'),
      failed('parse'),
    ]);
    expect(counts['scored-without-quote']).toBe(1);
    expect(counts['quote-not-found-cv']).toBe(1);
    expect(counts['missing-criterion']).toBe(1);
    expect(counts.other).toBe(0);
  });
});
