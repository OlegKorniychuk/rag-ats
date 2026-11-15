import type { WorkCounts } from './planner.js';

/**
 * Unit costs in USD at the third-party `gpt-5.4-mini` prices used throughout
 * the evals, as measured in Checkpoints A-C:
 * - a CV parse: $0.0028 on average (docs/eval/checkpoint-a.md);
 * - a score: $0.0053 (docs/eval/rag-scoring.md; about $0.005 in
 *   docs/eval/checkpoint-b.md);
 * - a criteria extraction: about $0.001 was measured (checkpoint-b.md); the
 *   plan budgets $0.003 for it to leave room for longer vacancy texts;
 * - embeddings: about $0.00002 per candidate (a CV is a few hundred tokens at
 *   $0.02 per 1M).
 */
export const UNIT_COST_USD = {
  parse: 0.0028,
  criteria: 0.003,
  score: 0.0053,
  embedding: 0.00002,
} as const;

/** Safety margin on top of the measured unit costs. */
export const MARGIN = 1.3;

export interface EstimateLine {
  label: string;
  count: number;
  unitUsd: number;
  subtotalUsd: number;
}

export interface Estimate {
  lines: EstimateLine[];
  subtotalUsd: number;
  margin: number;
  totalUsd: number;
}

export function estimate(counts: WorkCounts, margin = MARGIN): Estimate {
  const lines: EstimateLine[] = [
    ['CV parses', counts.parses, UNIT_COST_USD.parse],
    [
      'Criteria extractions',
      counts.criteriaExtractions,
      UNIT_COST_USD.criteria,
    ],
    ['Scores', counts.scores, UNIT_COST_USD.score],
    ['Embeddings (per candidate)', counts.embeddings, UNIT_COST_USD.embedding],
  ].map(([label, count, unitUsd]) => ({
    label: label as string,
    count: count as number,
    unitUsd: unitUsd as number,
    subtotalUsd: (count as number) * (unitUsd as number),
  }));
  const subtotalUsd = lines.reduce((sum, l) => sum + l.subtotalUsd, 0);
  return { lines, subtotalUsd, margin, totalUsd: subtotalUsd * margin };
}

/** Estimated cost of one persona's work, with the margin. */
export function personaEstimateUsd(
  applications: number,
  needsParse: boolean,
  margin = MARGIN,
): number {
  const base =
    applications * UNIT_COST_USD.score +
    (needsParse ? UNIT_COST_USD.parse + UNIT_COST_USD.embedding : 0);
  return base * margin;
}

/** Estimated cost of extracting one vacancy's criteria, with the margin. */
export const criteriaEstimateUsd = (margin = MARGIN): number =>
  UNIT_COST_USD.criteria * margin;

export function renderEstimate(
  estimateResult: Estimate,
  maxUsd: number,
): string {
  const rows = estimateResult.lines.map(
    (l) =>
      `  ${l.label.padEnd(28)} ${String(l.count).padStart(5)} x $${l.unitUsd.toFixed(5)} = $${l.subtotalUsd.toFixed(4)}`,
  );
  return [
    ...rows,
    `  ${'Subtotal'.padEnd(28)} ${' '.repeat(22)}$${estimateResult.subtotalUsd.toFixed(4)}`,
    `  ${`With ${estimateResult.margin}x margin`.padEnd(28)} ${' '.repeat(22)}$${estimateResult.totalUsd.toFixed(4)}`,
    `  Cap (--max-usd): $${maxUsd.toFixed(2)} ${estimateResult.totalUsd > maxUsd ? '(estimate is OVER the cap)' : '(estimate is within the cap)'}`,
  ].join('\n');
}
