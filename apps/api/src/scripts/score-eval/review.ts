import type { PairResult } from './result.js';

export const REVIEW_LABELS = ['supports', 'weak', 'irrelevant'] as const;
export type ReviewLabel = (typeof REVIEW_LABELS)[number];

export const REVIEW_COLUMNS = [
  'row',
  'pair',
  'criterion',
  'score',
  'source',
  'quote',
  'label',
  'note',
] as const;

export interface ReviewRow {
  /** Stable id: `vacancyId/cvId/criterionId/qN`. */
  row: string;
  pair: string;
  /** Criterion text with its importance, e.g. `Kafka (must)`. */
  criterion: string;
  score: number;
  source: string;
  quote: string;
  /** Empty until a reviewer fills it in. */
  label: string;
  note: string;
}

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

/** One row per citation of run 1 (failed pairs have none). */
export function buildReviewRows(pairs: PairResult[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const pair of pairs) {
    if (pair.run !== 1 || pair.status !== 'scored') continue;
    for (const criterion of pair.criteria) {
      criterion.quotes.forEach((quote, index) => {
        rows.push({
          row: `${pair.vacancyId}/${pair.cvId}/${criterion.id}/q${index + 1}`,
          pair: `${pair.vacancyId} x ${pair.cvId}`,
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

/** Backslash and pipe escaped, newlines flattened, so a cell stays on one line. */
export function escapeCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\r?\n\s*/g, ' ');
}

function unescapeCell(value: string): string {
  return value.replace(/\\([\\|])/g, '$1');
}

/** Splits a table line on unescaped pipes; the outer pipes are dropped. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      current += ch + line[i + 1];
      i++;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  // Leading and trailing pipes yield empty first and last cells.
  return cells.slice(1, -1).map((c) => unescapeCell(c.trim()));
}

function tableLine(cells: string[]): string {
  return `| ${cells.map(escapeCell).join(' | ')} |`;
}

export function renderReviewStub(label: string, rows: ReviewRow[]): string {
  return [
    `# Citation review: ${label}`,
    '',
    'Fill the `label` column of every row with one of: `supports` (the quote is evidence for that criterion at that score), `weak` (related but not enough on its own), `irrelevant` (filler, or about something else). Use `note` for anything worth discussing. Escape a literal pipe in a cell as `\\|`.',
    '',
    `| ${REVIEW_COLUMNS.join(' | ')} |`,
    `| ${REVIEW_COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows.map((r) =>
      tableLine([
        r.row,
        r.pair,
        r.criterion,
        String(r.score),
        r.source,
        r.quote,
        r.label,
        r.note,
      ]),
    ),
    '',
  ].join('\n');
}

/**
 * Parses a review file. Unknown labels are rejected with every offending row
 * id; an empty label means "not reviewed yet".
 */
export function parseReview(markdown: string): ReviewRow[] {
  const rows: ReviewRow[] = [];
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    const cells = splitCells(trimmed);
    if (!inTable) {
      if (cells[0]?.toLowerCase() !== 'row') continue;
      if (cells.join('|').toLowerCase() !== REVIEW_COLUMNS.join('|')) {
        throw new ReviewError(
          `Unexpected review table header, expected columns: ${REVIEW_COLUMNS.join(', ')}`,
        );
      }
      inTable = true;
      continue;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue; // separator
    if (cells.length !== REVIEW_COLUMNS.length) {
      throw new ReviewError(
        `Malformed review row (expected ${REVIEW_COLUMNS.length} cells, got ${cells.length}): ${cells[0] ?? trimmed.slice(0, 60)}`,
      );
    }
    const [row, pair, criterion, score, source, quote, label, note] = cells;
    rows.push({
      row,
      pair,
      criterion,
      score: Number(score),
      source,
      quote,
      label: label.toLowerCase(),
      note,
    });
  }
  if (rows.length === 0) throw new ReviewError('No review rows found');

  const unknown = rows.filter(
    (r) =>
      r.label !== '' && !(REVIEW_LABELS as readonly string[]).includes(r.label),
  );
  if (unknown.length > 0) {
    throw new ReviewError(
      `Unknown label(s) (allowed: ${REVIEW_LABELS.join(', ')}):\n${unknown
        .map((r) => `  - ${r.row}: "${r.label}"`)
        .join('\n')}`,
    );
  }
  return rows;
}

export interface LabelCounts {
  supports: number;
  weak: number;
  irrelevant: number;
  unlabelled: number;
  total: number;
}

export const SCORE_BUCKETS = ['0', '1-49', '50+'] as const;
export type ScoreBucket = (typeof SCORE_BUCKETS)[number];

export function scoreBucket(score: number): ScoreBucket {
  if (score <= 0) return '0';
  return score < 50 ? '1-49' : '50+';
}

export interface ReviewSummary {
  overall: LabelCounts;
  byVacancy: Record<string, LabelCounts>;
  byBucket: Record<ScoreBucket, LabelCounts>;
}

const emptyCounts = (): LabelCounts => ({
  supports: 0,
  weak: 0,
  irrelevant: 0,
  unlabelled: 0,
  total: 0,
});

function count(counts: LabelCounts, label: string): void {
  counts.total += 1;
  if (label === '') counts.unlabelled += 1;
  else counts[label as ReviewLabel] += 1;
}

export function summariseReview(rows: ReviewRow[]): ReviewSummary {
  const summary: ReviewSummary = {
    overall: emptyCounts(),
    byVacancy: {},
    byBucket: {
      '0': emptyCounts(),
      '1-49': emptyCounts(),
      '50+': emptyCounts(),
    },
  };
  for (const r of rows) {
    const vacancy = r.row.split('/')[0];
    summary.byVacancy[vacancy] ??= emptyCounts();
    count(summary.overall, r.label);
    count(summary.byVacancy[vacancy], r.label);
    count(summary.byBucket[scoreBucket(r.score)], r.label);
  }
  return summary;
}

/** supports + weak as a share of the labelled rows; null when none labelled. */
export function acceptableShare(counts: LabelCounts): number | null {
  const labelled = counts.total - counts.unlabelled;
  return labelled === 0 ? null : (counts.supports + counts.weak) / labelled;
}

function countsRow(name: string, c: LabelCounts): string {
  const share = acceptableShare(c);
  const pct = share === null ? 'n/a' : `${(share * 100).toFixed(1)}%`;
  return `| ${escapeCell(name)} | ${c.total} | ${c.supports} | ${c.weak} | ${c.irrelevant} | ${c.unlabelled} | ${pct} |`;
}

export function renderReviewSummary(summary: ReviewSummary): string {
  const header = [
    '| {{k}} | Citations | supports | weak | irrelevant | unlabelled | supports + weak |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const table = (key: string, rows: string[]): string[] => [
    header[0].replace('{{k}}', key),
    header[1],
    ...rows,
    '',
  ];
  return [
    '# Citation review summary',
    '',
    ...table('Scope', [countsRow('All', summary.overall)]),
    '## By vacancy',
    '',
    ...table(
      'Vacancy',
      Object.keys(summary.byVacancy)
        .sort()
        .map((v) => countsRow(v, summary.byVacancy[v])),
    ),
    '## By score bucket',
    '',
    ...table(
      'Score',
      SCORE_BUCKETS.map((b) => countsRow(b, summary.byBucket[b])),
    ),
  ].join('\n');
}

/** Small seeded PRNG (mulberry32); returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic sample of `n` rows (seeded Fisher-Yates), returned in review
 * file order. Asking for at least as many rows as exist returns them all.
 */
export function sampleRows(
  rows: ReviewRow[],
  n: number,
  seed: number,
): ReviewRow[] {
  const random = mulberry32(seed);
  const indices = rows.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, Math.max(0, n))
    .sort((a, b) => a - b)
    .map((i) => rows[i]);
}

export function renderSample(
  rows: ReviewRow[],
  n: number,
  seed: number,
): string {
  return [
    `## Spot-check sample (${rows.length} of ${n} requested, seed ${seed})`,
    '',
    '| row | criterion | score | source | quote | label | agree? |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      tableLine([
        r.row,
        r.criterion,
        String(r.score),
        r.source,
        r.quote,
        r.label,
        '',
      ]),
    ),
    '',
  ].join('\n');
}
