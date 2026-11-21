import type { EvidenceUnit } from '../../scoring/evidence-units.js';
import { resolveCitations } from '../../scoring/resolve-citations.js';
import {
  bucketProblem,
  bucketsOfProblems,
  groundingBucketCounts,
  type GroundingBucket,
} from './grounding.js';
import type { ScoreJobRecord } from './score-record.js';

const UNITS: ReadonlyMap<string, EvidenceUnit> = new Map([
  ['S1', { id: 'S1', source: 'cv', text: 'Built payment services in Kotlin.' }],
  ['G1', { id: 'G1', source: 'github', text: 'Repo: seed-repo, Rust.' }],
]);

/** The real problems `resolveCitations` produces for one bad response on the final attempt. */
function problemsFor(
  criteria: Array<{ criterionId: string; score: number; evidence: string[] }>,
  expected: string[],
): string[] {
  return resolveCitations({ criteria }, UNITS, expected, {
    zeroUnsupported: true,
  }).problems;
}

describe('bucketProblem against the real resolveCitations strings', () => {
  const cases: Array<[GroundingBucket, string[]]> = [
    [
      'unknown-evidence-id',
      problemsFor(
        [{ criterionId: 'c1', score: 70, evidence: ['S99'] }],
        ['c1'],
      ),
    ],
    [
      'unknown-criterion',
      problemsFor(
        [
          { criterionId: 'zzz', score: 0, evidence: ['S1'] },
          { criterionId: 'c1', score: 0, evidence: ['S1'] },
        ],
        ['c1'],
      ),
    ],
    [
      'missing-criterion',
      problemsFor(
        [{ criterionId: 'c1', score: 0, evidence: ['S1'] }],
        ['c1', 'c2'],
      ),
    ],
    [
      'duplicate-criterion',
      problemsFor(
        [
          { criterionId: 'c1', score: 0, evidence: ['S1'] },
          { criterionId: 'c1', score: 0, evidence: ['S1'] },
        ],
        ['c1'],
      ),
    ],
  ];

  it.each(cases)('%s', (bucket, problems) => {
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map(bucketProblem)).toContain(bucket);
    // and nothing in these single-cause responses falls into "other"
    expect(problems.map(bucketProblem)).not.toContain('other');
  });

  it('keeps the literal wording classified (guards a resolver rewording)', () => {
    expect(bucketProblem('Criterion c1 cites unknown evidence id "S99"')).toBe(
      'unknown-evidence-id',
    );
    expect(bucketProblem('Unknown criterion id "zzz"')).toBe(
      'unknown-criterion',
    );
    expect(bucketProblem('Criterion c3 is missing')).toBe('missing-criterion');
    expect(bucketProblem('Criterion c3 appears more than once')).toBe(
      'duplicate-criterion',
    );
  });

  it('puts anything unrecognised, including old quote-era wording, into other', () => {
    expect(bucketProblem('something new')).toBe('other');
    expect(
      bucketProblem('Criterion c1 has a score above 0 but no quotes'),
    ).toBe('other');
    // zeroed on the final attempt, so never a failure cause any more
    expect(
      bucketProblem('Criterion c1 has a score above 0 but cites no evidence'),
    ).toBe('other');
  });
});

describe('bucketsOfProblems', () => {
  it('lists distinct buckets in a stable order', () => {
    expect(
      bucketsOfProblems([
        'Criterion c2 cites unknown evidence id "S98"',
        'Criterion c1 is missing',
        'Criterion c3 cites unknown evidence id "S99"',
      ]),
    ).toEqual(['unknown-evidence-id', 'missing-criterion']);
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
        'Criterion c2 cites unknown evidence id "S98"',
        'Criterion c3 cites unknown evidence id "S99"',
      ]),
      failed('grounding', ['Criterion c1 is missing']),
      failed('api'),
      failed('parse'),
    ]);
    expect(counts['unknown-evidence-id']).toBe(1);
    expect(counts['missing-criterion']).toBe(1);
    expect(counts.other).toBe(0);
  });
});
