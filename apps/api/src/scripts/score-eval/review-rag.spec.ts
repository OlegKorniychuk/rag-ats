import {
  buildReviewRows,
  parseReview,
  renderReviewStub,
  renderSample,
  REVIEW_COLUMNS,
  REVIEW_COLUMNS_RAG,
} from './review.js';
import type { PairResult } from './result.js';

const pair = (withRetrieved: boolean): PairResult => ({
  vacancyId: 'v1',
  cvId: 'cv1',
  run: 1,
  status: 'scored',
  error: null,
  overall: 80,
  rationale: 'r',
  criteria: [
    {
      id: 'c1',
      text: 'Kafka',
      importance: 'must',
      score: 80,
      reasoning: 'x',
      quotes: [{ source: 'cv', text: 'Built Kafka | pipelines' }],
      ...(withRetrieved && {
        retrieved: [
          {
            chunkId: 'ch2',
            source: 'cv' as const,
            similarity: 0.6,
            text: 'Built Kafka | pipelines',
          },
          {
            chunkId: 'ch5',
            source: 'github' as const,
            similarity: 0.4,
            text: 'Repo: demo',
          },
        ],
      }),
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
});

describe('review stub in rag mode', () => {
  const rows = buildReviewRows([pair(true)]);

  it('adds retrieved previews to the rows', () => {
    expect(rows[0].retrieved).toBe(
      'ch2 [cv] 0.60 "Built Kafka | pipelines"; ch5 [github] 0.40 "Repo: demo"',
    );
  });

  it('renders a retrieved column before label and round-trips through parseReview', () => {
    const md = renderReviewStub('rag-1', rows);
    expect(md).toContain(`| ${REVIEW_COLUMNS_RAG.join(' | ')} |`);
    const parsed = parseReview(md);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].quote).toBe('Built Kafka | pipelines');
    expect(parsed[0].retrieved).toBe(rows[0].retrieved);
    expect(parsed[0].label).toBe('');
  });

  it('keeps the label and note readable after a reviewer fills them in', () => {
    const md = renderReviewStub('rag-1', rows).replace(
      /\|\s*\|\s*\|\s*$/m,
      '| supports | fine |',
    );
    const [row] = parseReview(md);
    expect(row.label).toBe('supports');
    expect(row.note).toBe('fine');
  });

  it('adds a retrieved column to the sample', () => {
    expect(renderSample(rows, 1, 1)).toContain('| quote | retrieved | label |');
  });
});

describe('review stub in full text mode', () => {
  it('keeps the original columns', () => {
    const rows = buildReviewRows([pair(false)]);
    expect(rows[0].retrieved).toBeUndefined();
    const md = renderReviewStub('t', rows);
    expect(md).toContain(`| ${REVIEW_COLUMNS.join(' | ')} |`);
    expect(md).not.toContain('retrieved');
    expect(parseReview(md)[0]).not.toHaveProperty('retrieved');
  });
});
