/**
 * Citation review of the eval's scores: an adapter from cache records to the
 * rows of `score-eval/review.ts`, which owns the stub format, the parser and
 * the summary. The review is of run 1 only, as in score-eval.
 */
import {
  acceptableShare,
  renderReviewStub,
  sampleRows,
  summariseReview,
  type LabelCounts,
  type ReviewRow,
} from '../score-eval/review.js';
import type {
  ScoreJobRecord,
  ScoreOkRecord,
  ScoringMode,
} from './score-record.js';

export {
  parseReview,
  renderReviewSummary,
  ReviewError,
  summariseReview,
} from '../score-eval/review.js';

/** One row per citation of the ok run-1 records of `mode`, in record order. */
export function buildEvalReviewRows(
  records: readonly ScoreJobRecord[],
  mode: ScoringMode,
): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const ok = records.filter(
    (r): r is ScoreOkRecord =>
      r.status === 'ok' && r.mode === mode && r.run === 1,
  );
  for (const record of ok) {
    for (const criterion of record.criteria) {
      criterion.quotes.forEach((quote, index) => {
        rows.push({
          row: `${record.vacancyId}/${record.personaId}/${criterion.id}/q${index + 1}`,
          pair: `${record.vacancyId} x ${record.personaId}`,
          criterion: `${criterion.text} (${criterion.importance})`,
          score: criterion.score,
          source: quote.source,
          quote: quote.text,
          label: '',
          note: '',
        });
      });
    }
  }
  return rows;
}

export interface ReviewStub {
  /** Citations available in the mode's ok run-1 records. */
  available: number;
  /** Rows in the stub (`min(n, available)`). */
  rows: number;
  markdown: string;
}

/** A seeded random sample of `n` citations of `mode`, as a stub to fill in. */
export function buildReviewStub(
  records: readonly ScoreJobRecord[],
  mode: ScoringMode,
  n: number,
  seed: number,
): ReviewStub {
  const all = buildEvalReviewRows(records, mode);
  const picked = sampleRows(all, n, seed);
  return {
    available: all.length,
    rows: picked.length,
    markdown: renderReviewStub(`eval baseline, ${mode}`, picked),
  };
}

/** What the aggregate keeps of a filled-in review file. */
export interface ReviewAggregate {
  mode: ScoringMode;
  total: number;
  labelled: number;
  supports: number;
  weak: number;
  irrelevant: number;
  /** supports over labelled; null when nothing is labelled. */
  supportsShare: number | null;
  /** (supports + weak) over labelled: the citation relevance rate. */
  relevanceRate: number | null;
}

export function reviewAggregateOf(
  mode: ScoringMode,
  rows: ReviewRow[],
): ReviewAggregate {
  const counts: LabelCounts = summariseReview(rows).overall;
  const labelled = counts.total - counts.unlabelled;
  return {
    mode,
    total: counts.total,
    labelled,
    supports: counts.supports,
    weak: counts.weak,
    irrelevant: counts.irrelevant,
    supportsShare: labelled === 0 ? null : counts.supports / labelled,
    relevanceRate: acceptableShare(counts),
  };
}

/** Where the summary of a review file goes: `x.md` -> `x.summary.md`. */
export const summaryPathOf = (reviewPath: string): string =>
  reviewPath.replace(/(\.md)?$/, '.summary.md');
