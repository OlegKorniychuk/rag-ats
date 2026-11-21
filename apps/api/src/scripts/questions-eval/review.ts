import type { InterviewQuestion } from '@rag-ats/shared';
import { createRng } from '../synth/rng.js';
import type { Band } from '../synth/types.js';
import type { QuestionsRecord } from './metrics.js';
import { BANDS } from './sample.js';

export const REVIEW_HEADER =
  '| # | band | vacancy | candidate | criterion (score) | basis | question | purpose | quotes | grounded (yes/partly/no) | useful (yes/no) |';
const SEPARATOR = `|${' --- |'.repeat(11)}`;

const GROUNDED = ['yes', 'partly', 'no'] as const;
const USEFUL = ['yes', 'no'] as const;

export class QuestionsReviewError extends Error {}

/** One table cell: one line, pipes escaped. */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
}

interface ReviewItem {
  record: QuestionsRecord;
  question: InterviewQuestion;
}

/**
 * The review table: `count` questions of ok records, drawn round-robin across
 * the bands (each band's questions shuffled with the seed), so a band runs
 * out only when it has no more questions. Label cells are left empty.
 */
export function buildQuestionsReview(
  records: QuestionsRecord[],
  count: number,
  seed: number,
): string {
  const rng = createRng(seed);
  const pools = new Map<Band, ReviewItem[]>(
    BANDS.map((band) => [
      band,
      rng.shuffle(
        records
          .filter((r) => r.status === 'ok' && r.item.band === band)
          .flatMap((record) =>
            record.questions.map((question) => ({ record, question })),
          ),
      ),
    ]),
  );
  const picked: ReviewItem[] = [];
  while (picked.length < count) {
    let added = false;
    for (const band of BANDS) {
      const next = pools.get(band)!.shift();
      if (next && picked.length < count) {
        picked.push(next);
        added = true;
      }
    }
    if (!added) break;
  }

  const rows = picked.map(({ record, question }, i) => {
    const score = record.criterionScores[question.criterionId];
    const quotes = question.quotes
      .map((q) => `${q.source}: ${q.text}`)
      .join(' / ');
    return `| ${[
      String(i + 1),
      record.item.band,
      cell(record.item.vacancySpecId),
      cell(`${record.item.personaId} (${record.item.applicationId})`),
      cell(`${question.criterion} (${score ?? '?'})`),
      question.basis,
      cell(question.text),
      cell(question.purpose),
      cell(quotes),
      '',
      '',
    ].join(' | ')} |`;
  });

  return [
    '# Interview questions: review',
    '',
    'Label each question. **grounded**: yes / partly / no (does the question follow from the quotes and the criterion score?). **useful**: yes / no (would you ask it in an interview?). Leave a cell empty to skip it.',
    '',
    REVIEW_HEADER,
    SEPARATOR,
    ...rows,
    '',
  ].join('\n');
}

export interface QuestionsReviewSummary {
  /** Rows with at least one label. */
  labelled: number;
  grounded: Record<(typeof GROUNDED)[number], number>;
  useful: Record<(typeof USEFUL)[number], number>;
}

/** Splits a table row into cells, honouring escaped pipes. */
function cells(line: string): string[] {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

/** Counts the labels of a filled-in review table; an unknown label throws. */
export function summariseQuestionsReview(
  markdown: string,
): QuestionsReviewSummary {
  const summary: QuestionsReviewSummary = {
    labelled: 0,
    grounded: { yes: 0, partly: 0, no: 0 },
    useful: { yes: 0, no: 0 },
  };
  for (const line of markdown.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const row = cells(line);
    const n = row[0];
    const grounded = (row[9] ?? '').toLowerCase();
    const useful = (row[10] ?? '').toLowerCase();
    if (grounded && !(GROUNDED as readonly string[]).includes(grounded)) {
      throw new QuestionsReviewError(
        `row ${n}: grounded must be yes, partly or no (got "${row[9]}")`,
      );
    }
    if (useful && !(USEFUL as readonly string[]).includes(useful)) {
      throw new QuestionsReviewError(
        `row ${n}: useful must be yes or no (got "${row[10]}")`,
      );
    }
    if (!grounded && !useful) continue;
    summary.labelled += 1;
    if (grounded) summary.grounded[grounded as keyof typeof summary.grounded]++;
    if (useful) summary.useful[useful as keyof typeof summary.useful]++;
  }
  return summary;
}

/** Markdown of a summary (written next to the review file). */
export function renderQuestionsReviewSummary(
  summary: QuestionsReviewSummary,
): string {
  const pct = (n: number, total: number) =>
    total === 0 ? 'n/a' : `${((100 * n) / total).toFixed(0)} %`;
  const g = summary.grounded;
  const u = summary.useful;
  const gTotal = g.yes + g.partly + g.no;
  const uTotal = u.yes + u.no;
  return [
    '# Interview questions: review summary',
    '',
    `Labelled questions: ${summary.labelled}`,
    '',
    '| label | value | count | share |',
    '| --- | --- | --- | --- |',
    `| grounded | yes | ${g.yes} | ${pct(g.yes, gTotal)} |`,
    `| grounded | partly | ${g.partly} | ${pct(g.partly, gTotal)} |`,
    `| grounded | no | ${g.no} | ${pct(g.no, gTotal)} |`,
    `| useful | yes | ${u.yes} | ${pct(u.yes, uTotal)} |`,
    `| useful | no | ${u.no} | ${pct(u.no, uTotal)} |`,
    '',
  ].join('\n');
}

/** `x.review.md` -> `x.review.summary.md`. */
export const reviewSummaryPathOf = (path: string): string =>
  `${path.replace(/\.md$/, '')}.summary.md`;
