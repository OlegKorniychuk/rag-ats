/** The evidence-eval output file and its Markdown report. */
import type { Maybe } from '../eval/metrics.js';
import type { EvidenceRecallResult } from './recall.js';

export const EVIDENCE_EVAL_DIR = 'docs/eval/rag-params';

export interface IndexStats {
  /** Candidates with at least one chunk. */
  candidates: number;
  chunks: { cv: number; github: number };
  meanCvChunkChars: number;
  maxCvChunkChars: number;
  /** Distinct `candidate_chunks.model` values (one, unless the index is mixed). */
  models: string[];
}

export interface EvidenceEvalFile {
  label: string;
  database: string;
  /** The model the criterion texts were embedded with. */
  embeddingModel: string;
  citationsFrom: string;
  at: string;
  index: IndexStats;
  criterionTexts: number;
  spentUsd: number;
  recall: EvidenceRecallResult;
}

const pct = (value: Maybe): string =>
  value === null ? '–' : `${(value * 100).toFixed(1)} %`;
const num = (value: Maybe): string =>
  value === null ? '–' : String(Math.round(value));

export function renderEvidenceReport(file: EvidenceEvalFile): string {
  const { index, recall } = file;
  const lines = [
    `# Evidence recall@k: ${file.label}`,
    '',
    `Index: database \`${file.database}\`, chunks embedded with ${index.models.map((m) => `\`${m}\``).join(', ')}; ${index.candidates} candidates, ${index.chunks.cv} CV chunks (mean ${index.meanCvChunkChars}, max ${index.maxCvChunkChars} chars) and ${index.chunks.github} GitHub chunks. Criterion texts (${file.criterionTexts}) embedded with \`${file.embeddingModel}\`.`,
    '',
    `Labels: the quotes of the \`full_text\` run 1 scores of \`${file.citationsFrom}\`: ${recall.items} criteria with evidence, ${recall.quotes} quotes (${recall.quotesCv} CV, ${recall.quotesGithub} GitHub). These are silver labels: what the \`full_text\` scorer cited, not human-judged evidence.`,
    '',
    'A quote is covered at k when one of the candidate\'s k chunks nearest to the criterion (same source) contains it, whitespace ignored. "all" is every chunk of the candidate: what is missing there is cut by a chunk boundary, not ranked too low.',
    '',
    '| k | Quote recall | CV | GitHub | Criteria, all quotes | Criteria, any quote | Context chars | Share of chunks |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...recall.rows.map(
      (row) =>
        `| ${row.k} | ${pct(row.quoteRecall)} | ${pct(row.quoteRecallCv)} | ${pct(row.quoteRecallGithub)} | ${pct(row.criterionAll)} | ${pct(row.criterionAny)} | ${num(row.meanContextChars)} | ${pct(row.meanChunkShare)} |`,
    ),
    '',
    `Run ${file.at}; embedding spend $${file.spentUsd.toFixed(4)}.`,
    '',
  ];
  return lines.join('\n');
}
