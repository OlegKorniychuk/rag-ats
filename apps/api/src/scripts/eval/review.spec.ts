import {
  buildEvalReviewRows,
  buildReviewStub,
  parseReview,
  renderReviewSummary,
  reviewAggregateOf,
  summariseReview,
  summaryPathOf,
} from './review.js';
import { formatText } from './layout.js';
import { renderReviewStub } from '../score-eval/review.js';
import { fixtureRecords, ok } from './test-fixture.js';

describe('buildEvalReviewRows', () => {
  it('has one row per citation of the ok run-1 records of the mode', () => {
    const rows = buildEvalReviewRows(fixtureRecords(), 'rag');
    // five ok run-1 rag records with one quote each; failures and run 2 have none
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      row: 'v1/p1/c1/q1',
      pair: 'v1 x p1',
      criterion: 'Production experience with Rust (must)',
      score: 70,
      source: 'github',
      quote: 'Rust service',
      label: '',
      note: '',
    });
    expect(rows.every((r) => r.row.startsWith('v1/'))).toBe(true);
  });

  it('numbers several quotes of a criterion', () => {
    const record = ok('full_text', 'p9', 50, {
      criteria: [
        {
          id: 'c1',
          text: 'Rust',
          importance: 'nice',
          score: 50,
          reasoning: '',
          quotes: [
            { source: 'cv', text: 'one' },
            { source: 'cv', text: 'two' },
          ],
        },
      ],
    });
    expect(
      buildEvalReviewRows([record], 'full_text').map((r) => r.row),
    ).toEqual(['v1/p9/c1/q1', 'v1/p9/c1/q2']);
  });
});

describe('buildReviewStub', () => {
  it('draws n citations with a seed, deterministically, and never more than exist', () => {
    const a = buildReviewStub(fixtureRecords(), 'full_text', 3, 5);
    const b = buildReviewStub(fixtureRecords(), 'full_text', 3, 5);
    expect(a.rows).toBe(3);
    expect(a.available).toBe(5); // p1 cites nothing
    expect(a.markdown).toBe(b.markdown);
    expect(buildReviewStub(fixtureRecords(), 'full_text', 99, 5).rows).toBe(5);
  });

  it('round-trips through prettier, the parser and the summary', async () => {
    const stub = buildReviewStub(fixtureRecords(), 'full_text', 4, 1);
    // what the CLI writes: through prettier
    const written = await formatText('review.md', stub.markdown, 'markdown');
    const rows = parseReview(written);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.label === '')).toBe(true);

    // a reviewer labels the first two rows; the file goes through prettier again
    const labels = ['supports', 'irrelevant'];
    const filled = await formatText(
      'review.md',
      renderReviewStub(
        'x',
        rows.map((r, i) => ({ ...r, label: labels[i] ?? '' })),
      ),
      'markdown',
    );
    const parsed = parseReview(filled);
    const summary = summariseReview(parsed);
    expect(summary.overall).toMatchObject({
      total: 4,
      supports: 1,
      irrelevant: 1,
      unlabelled: 2,
    });
    expect(renderReviewSummary(summary)).toMatch(/Citation review summary/);

    const agg = reviewAggregateOf('full_text', parsed);
    expect(agg).toMatchObject({
      mode: 'full_text',
      total: 4,
      labelled: 2,
      supports: 1,
      irrelevant: 1,
      supportsShare: 0.5,
      relevanceRate: 0.5,
    });
  });

  it('has no rates for an unlabelled review', () => {
    const rows = buildEvalReviewRows(fixtureRecords(), 'rag');
    expect(reviewAggregateOf('rag', rows)).toMatchObject({
      labelled: 0,
      supportsShare: null,
      relevanceRate: null,
    });
  });
});

describe('summaryPathOf', () => {
  it('puts the summary next to the review', () => {
    expect(summaryPathOf('a/review-rag.md')).toBe('a/review-rag.summary.md');
    expect(summaryPathOf('a/review')).toBe('a/review.summary.md');
  });
});
