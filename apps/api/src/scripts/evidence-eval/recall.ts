/**
 * Evidence recall@k (RAG parameter experiments): how much of the evidence the
 * `full_text` scorer cited for a criterion is inside the candidate's k chunks
 * nearest to that criterion, i.e. what `rag` scoring would have shown it.
 * The citations are silver labels (the model's, not a human's). Pure.
 */
import type { Maybe } from '../eval/metrics.js';
import type { RecordedQuote, ScoreJobRecord } from '../eval/score-record.js';

/** The k values reported; `'all'` is every chunk of the candidate. */
export const EVIDENCE_KS = [1, 2, 3, 4, 5, 6, 8, 10] as const;
export type EvidenceK = (typeof EVIDENCE_KS)[number] | 'all';

/** A criterion of a `full_text` score that cited at least one evidence unit. */
export interface CitedCriterion {
  /** Unique per record and criterion. */
  key: string;
  personaId: string;
  vacancyId: string;
  criterionId: string;
  /** The criterion text, which `rag` scoring embeds as the query. */
  text: string;
  quotes: RecordedQuote[];
}

export interface RankedChunk {
  source: 'cv' | 'github';
  text: string;
}

export interface EvidenceKRow {
  k: EvidenceK;
  /** Covered quotes / quotes (micro). */
  quoteRecall: Maybe;
  quoteRecallCv: Maybe;
  quoteRecallGithub: Maybe;
  /** Criteria with every quote covered. */
  criterionAll: Maybe;
  /** Criteria with at least one quote covered. */
  criterionAny: Maybe;
  /** Mean characters of the top k chunks (the context `rag` would send). */
  meanContextChars: Maybe;
  /** Mean of min(k, n) / n, n = the candidate's chunk count. */
  meanChunkShare: Maybe;
}

export interface EvidenceRecallResult {
  items: number;
  quotes: number;
  quotesCv: number;
  quotesGithub: number;
  rows: EvidenceKRow[];
}

/** The `full_text`, run 1, ok records' criteria that cite evidence. */
export function citedCriteria(
  records: Iterable<ScoreJobRecord>,
): CitedCriterion[] {
  const items: CitedCriterion[] = [];
  for (const record of records) {
    if (
      record.status !== 'ok' ||
      record.mode !== 'full_text' ||
      record.run !== 1
    ) {
      continue;
    }
    for (const criterion of record.criteria) {
      if (criterion.quotes.length === 0) continue;
      items.push({
        key: `${record.key}|${criterion.id}`,
        personaId: record.personaId,
        vacancyId: record.vacancyId,
        criterionId: criterion.id,
        text: criterion.text,
        quotes: criterion.quotes,
      });
    }
  }
  return items;
}

/**
 * Whitespace removed: evidence units join wrapped lines with a space (or
 * nothing after a hyphen), chunks keep the line breaks.
 */
const compact = (text: string): string => text.replace(/\s+/gu, '');

/** True when one chunk of the quote's source contains the whole quote. */
export function quoteCovered(
  quote: RecordedQuote,
  chunks: readonly RankedChunk[],
): boolean {
  const needle = compact(quote.text);
  return chunks.some(
    (chunk) =>
      chunk.source === quote.source && compact(chunk.text).includes(needle),
  );
}

const ratio = (hits: number, total: number): Maybe =>
  total === 0 ? null : hits / total;

/**
 * Recall at every k of `EVIDENCE_KS` and at all chunks. `rankingOf` returns
 * the candidate's chunks nearest to the item's criterion first, all of them.
 */
export function evidenceRecall(
  items: readonly CitedCriterion[],
  rankingOf: (item: CitedCriterion) => readonly RankedChunk[],
): EvidenceRecallResult {
  const quotes = items.flatMap((i) => i.quotes);
  const quotesCv = quotes.filter((q) => q.source === 'cv').length;
  const quotesGithub = quotes.length - quotesCv;
  const rankings = items.map((item) => rankingOf(item));

  const rows = [...EVIDENCE_KS, 'all' as const].map((k): EvidenceKRow => {
    let covered = 0;
    let coveredCv = 0;
    let coveredGithub = 0;
    let all = 0;
    let any = 0;
    let chars = 0;
    let share = 0;
    items.forEach((item, index) => {
      const ranking = rankings[index];
      const top = k === 'all' ? ranking : ranking.slice(0, k);
      let hits = 0;
      for (const quote of item.quotes) {
        if (!quoteCovered(quote, top)) continue;
        hits += 1;
        if (quote.source === 'cv') coveredCv += 1;
        else coveredGithub += 1;
      }
      covered += hits;
      if (hits === item.quotes.length) all += 1;
      if (hits > 0) any += 1;
      chars += top.reduce((n, chunk) => n + chunk.text.length, 0);
      share += ranking.length === 0 ? 0 : top.length / ranking.length;
    });
    return {
      k,
      quoteRecall: ratio(covered, quotes.length),
      quoteRecallCv: ratio(coveredCv, quotesCv),
      quoteRecallGithub: ratio(coveredGithub, quotesGithub),
      criterionAll: ratio(all, items.length),
      criterionAny: ratio(any, items.length),
      meanContextChars: ratio(chars, items.length),
      meanChunkShare: ratio(share, items.length),
    };
  });

  return {
    items: items.length,
    quotes: quotes.length,
    quotesCv,
    quotesGithub,
    rows,
  };
}
