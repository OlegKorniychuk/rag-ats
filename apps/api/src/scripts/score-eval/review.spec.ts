import {
  buildReviewRows,
  escapeCell,
  mulberry32,
  parseReview,
  renderReviewStub,
  renderReviewSummary,
  renderSample,
  ReviewError,
  sampleRows,
  scoreBucket,
  summariseReview,
  type ReviewRow,
} from './review.js';
import type { PairResult } from './result.js';

const pair = (overrides: Partial<PairResult>): PairResult => ({
  vacancyId: 'backend-java',
  cvId: '02-senior-backend',
  run: 1,
  status: 'scored',
  error: null,
  overall: 80,
  rationale: 'r',
  criteria: [
    {
      id: 'c1',
      text: 'Kafka | streams',
      importance: 'must',
      score: 80,
      reasoning: 'x',
      quotes: [
        { source: 'cv', text: 'Built Kafka\npipelines | at scale' },
        { source: 'github', text: 'kafka-demo' },
      ],
    },
    {
      id: 'c3',
      text: 'Go',
      importance: 'nice',
      score: 0,
      reasoning: 'x',
      quotes: [],
    },
  ],
  attempts: 1,
  usage: null,
  costUsd: 0,
  expected: null,
  band: 'strong',
  bandResult: 'none',
  grounded: { ok: true, problems: [] },
  fillerSuspects: [],
  ...overrides,
});

describe('buildReviewRows', () => {
  it('emits one row per citation of run 1 with stable ids', () => {
    const rows = buildReviewRows([
      pair({}),
      pair({ run: 2 }),
      pair({ cvId: 'x', status: 'failed', criteria: [] }),
    ]);
    expect(rows.map((r) => r.row)).toEqual([
      'backend-java/02-senior-backend/c1/q1',
      'backend-java/02-senior-backend/c1/q2',
    ]);
    expect(rows[0]).toMatchObject({
      pair: 'backend-java x 02-senior-backend',
      criterion: 'Kafka | streams (must)',
      score: 80,
      source: 'cv',
      label: '',
      note: '',
    });
  });
});

describe('review stub', () => {
  it('escapes pipes, backslashes and newlines so each row stays on one line', () => {
    expect(escapeCell('a | b\\c\nd')).toBe('a \\| b\\\\c d');
    const stub = renderReviewStub('baseline', buildReviewRows([pair({})]));
    const dataLines = stub
      .split('\n')
      .filter((l) => l.startsWith('| backend-java/'));
    expect(dataLines).toHaveLength(2);
    expect(dataLines[0]).toContain('Built Kafka pipelines \\| at scale');
    expect(stub).toContain(
      '| row | pair | criterion | score | source | quote | label | note |',
    );
  });

  it('round-trips through parseReview', () => {
    const rows = buildReviewRows([pair({})]);
    const parsed = parseReview(renderReviewStub('baseline', rows));
    expect(parsed).toEqual([
      { ...rows[0], quote: 'Built Kafka pipelines | at scale' },
      rows[1],
    ]);
  });
});

describe('parseReview', () => {
  const filled = (labels: string[]) => {
    const rows = buildReviewRows([pair({})]);
    return renderReviewStub('b', rows)
      .split('\n')
      .map((line) => {
        if (!line.startsWith('| backend-java/')) return line;
        const label = labels.shift() ?? '';
        return line.replace(/\|  \|  \|$/, `| ${label} |  |`);
      })
      .join('\n');
  };

  it('reads labels case-insensitively', () => {
    const rows = parseReview(filled(['Supports', 'weak']));
    expect(rows.map((r) => r.label)).toEqual(['supports', 'weak']);
  });

  it('rejects unknown labels, listing the row ids', () => {
    const text = filled(['supports', 'great']);
    expect(() => parseReview(text)).toThrow(ReviewError);
    expect(() => parseReview(text)).toThrow(
      /backend-java\/02-senior-backend\/c1\/q2: "great"/,
    );
  });

  it('rejects a file without a review table', () => {
    expect(() => parseReview('# nothing here')).toThrow(/No review rows/);
  });

  it('rejects a malformed row', () => {
    const text = filled([]).replace(/\n$/, '\n| only | three | cells |\n');
    expect(() => parseReview(text)).toThrow(/Malformed review row/);
  });
});

describe('summariseReview', () => {
  const row = (id: string, score: number, label: string): ReviewRow => ({
    row: id,
    pair: 'p',
    criterion: 'c',
    score,
    source: 'cv',
    quote: 'q',
    label,
    note: '',
  });
  const rows = [
    row('v1/cv/c1/q1', 90, 'supports'),
    row('v1/cv/c2/q1', 30, 'weak'),
    row('v1/cv/c3/q1', 0, 'irrelevant'),
    row('v2/cv/c1/q1', 0, ''),
    row('v2/cv/c2/q1', 50, 'supports'),
  ];

  it('buckets scores', () => {
    expect([0, 1, 49, 50, 100].map(scoreBucket)).toEqual([
      '0',
      '1-49',
      '1-49',
      '50+',
      '50+',
    ]);
  });

  it('counts per label, vacancy and score bucket', () => {
    const s = summariseReview(rows);
    expect(s.overall).toEqual({
      supports: 2,
      weak: 1,
      irrelevant: 1,
      unlabelled: 1,
      total: 5,
    });
    expect(s.byVacancy.v1.total).toBe(3);
    expect(s.byVacancy.v2.unlabelled).toBe(1);
    expect(s.byBucket['0']).toMatchObject({
      irrelevant: 1,
      unlabelled: 1,
      total: 2,
    });
    expect(s.byBucket['1-49']).toMatchObject({ weak: 1, total: 1 });
    expect(s.byBucket['50+']).toMatchObject({ supports: 2, total: 2 });
  });

  it('renders the share of supports + weak among labelled rows', () => {
    const md = renderReviewSummary(summariseReview(rows));
    expect(md).toContain('| All | 5 | 2 | 1 | 1 | 1 | 75.0% |');
    expect(md).toContain('| v1 | 3 | 1 | 1 | 1 | 0 | 66.7% |');
    expect(md).toContain('## By score bucket');
  });
});

describe('seeded sampling', () => {
  const rows: ReviewRow[] = Array.from({ length: 50 }, (_, i) => ({
    row: `v/cv/c${i}/q1`,
    pair: 'p',
    criterion: 'c',
    score: i,
    source: 'cv',
    quote: 'q',
    label: '',
    note: '',
  }));

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seq = [a(), a(), a()];
    expect(seq).toEqual([b(), b(), b()]);
    expect(seq.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(mulberry32(43)()).not.toBe(seq[0]);
  });

  it('returns the same sample for the same seed, a different one otherwise', () => {
    const one = sampleRows(rows, 10, 7).map((r) => r.row);
    expect(sampleRows(rows, 10, 7).map((r) => r.row)).toEqual(one);
    expect(sampleRows(rows, 10, 8).map((r) => r.row)).not.toEqual(one);
    expect(new Set(one).size).toBe(10);
  });

  it('keeps file order and caps at the number of rows', () => {
    const picked = sampleRows(rows, 10, 7).map((r) => r.score);
    expect(picked).toEqual([...picked].sort((a, b) => a - b));
    expect(sampleRows(rows, 999, 1)).toHaveLength(50);
    expect(sampleRows(rows, 0, 1)).toEqual([]);
  });

  it('renders the sample with ids and an agree column', () => {
    const md = renderSample(sampleRows(rows, 2, 3), 2, 3);
    expect(md).toContain('seed 3');
    expect(md).toContain('| agree? |');
    expect(md.match(/\| v\/cv\//g)).toHaveLength(2);
  });
});
