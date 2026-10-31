import { PRICING_CAVEAT } from '../parse-eval/cost.js';
import { spread } from './checks.js';
import type { EvalResult, ExtractionResult, PairResult } from './result.js';

const usd = (value: number): string => `$${value.toFixed(4)}`;
const pct = (num: number, den: number): string =>
  den === 0 ? 'n/a' : `${((num / den) * 100).toFixed(1)}%`;

/** Escapes pipes and flattens newlines so text stays inside one table cell. */
const cell = (value: string): string =>
  value.replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ');

const pairKey = (p: { vacancyId: string; cvId: string }): string =>
  `${p.vacancyId}\u0000${p.cvId}`;

export interface Totals {
  pairs: number;
  scored: number;
  failed: number;
  grounded: number;
  retried: number;
  bandExpected: number;
  bandMatches: number;
  /** Pairs with at least two scored runs. */
  spreadPairs: number;
  meanSpread: number | null;
  maxSpread: number | null;
  extractionInput: number;
  extractionOutput: number;
  extractionCost: number;
  scoringInput: number;
  scoringOutput: number;
  scoringCost: number;
}

export function computeTotals(result: EvalResult): Totals {
  const { pairs, extractions } = result;
  const scored = pairs.filter((p) => p.status === 'scored');

  const byPair = new Map<string, number[]>();
  for (const p of scored) {
    const list = byPair.get(pairKey(p)) ?? [];
    list.push(p.overall!);
    byPair.set(pairKey(p), list);
  }
  const spreads = [...byPair.values()]
    .map(spread)
    .filter((s): s is number => s !== null);

  const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
  const expected = pairs.filter((p) => p.bandResult !== 'none');

  return {
    pairs: pairs.length,
    scored: scored.length,
    failed: pairs.length - scored.length,
    grounded: scored.filter((p) => p.grounded?.ok).length,
    retried: pairs.filter((p) => p.attempts > 1).length,
    bandExpected: expected.length,
    bandMatches: expected.filter((p) => p.bandResult === 'match').length,
    spreadPairs: spreads.length,
    meanSpread: spreads.length === 0 ? null : sum(spreads) / spreads.length,
    maxSpread: spreads.length === 0 ? null : Math.max(...spreads),
    extractionInput: sum(extractions.map((e) => e.usage?.inputTokens ?? 0)),
    extractionOutput: sum(extractions.map((e) => e.usage?.outputTokens ?? 0)),
    extractionCost: sum(extractions.map((e) => e.costUsd)),
    scoringInput: sum(pairs.map((p) => p.usage?.inputTokens ?? 0)),
    scoringOutput: sum(pairs.map((p) => p.usage?.outputTokens ?? 0)),
    scoringCost: sum(pairs.map((p) => p.costUsd)),
  };
}

function matrixCell(pairs: PairResult[]): string {
  if (pairs.length === 0) return '-';
  const sorted = [...pairs].sort((a, b) => a.run - b.run);
  const overalls = sorted
    .map((p) => (p.status === 'scored' ? String(p.overall) : 'F'))
    .join('/');
  const marks: string[] = [];
  const results = sorted.map((p) => p.bandResult).filter((r) => r !== 'none');
  if (results.length > 0) {
    marks.push(results.every((r) => r === 'match') ? '✓' : '✗');
  }
  if (sorted.some((p) => p.attempts > 1)) marks.push('R');
  if (sorted.some((p) => p.status === 'failed')) marks.push('F');
  return [overalls, ...marks].join(' ');
}

function matrix(result: EvalResult): string[] {
  const vacancyIds = result.vacancies
    .map((v) => v.id)
    .filter((id) => result.pairs.some((p) => p.vacancyId === id));
  const cvIds = result.cvs
    .map((c) => c.id)
    .filter((id) => result.pairs.some((p) => p.cvId === id));
  return [
    `| CV | ${vacancyIds.map(cell).join(' | ')} |`,
    `| --- | ${vacancyIds.map(() => '---').join(' | ')} |`,
    ...cvIds.map(
      (cvId) =>
        `| ${cell(cvId)} | ${vacancyIds
          .map((vacancyId) =>
            matrixCell(
              result.pairs.filter(
                (p) => p.vacancyId === vacancyId && p.cvId === cvId,
              ),
            ),
          )
          .join(' | ')} |`,
    ),
  ];
}

function extractionBlock(extraction: ExtractionResult): string[] {
  const lines = [`#### Run ${extraction.run}`, ''];
  if (extraction.error) {
    lines.push(`Extraction failed: ${extraction.error}`, '');
    return lines;
  }
  lines.push(
    `${extraction.criteria.length} criteria. Tokens: ${extraction.usage?.inputTokens ?? 0} in / ${extraction.usage?.outputTokens ?? 0} out, ${usd(extraction.costUsd)}.`,
    '',
    '| ID | Importance | Criterion |',
    '| --- | --- | --- |',
    ...extraction.criteria.map(
      (c) => `| ${c.id} | ${c.importance} | ${cell(c.text)} |`,
    ),
    '',
  );
  if (extraction.coverage) {
    const { covered, missing } = extraction.coverage;
    const total = covered.length + missing.length;
    lines.push(
      `Coverage of required terms: ${covered.length}/${total}. Missing: ${missing.length === 0 ? '_none_' : missing.join(', ')}.`,
      '',
    );
  }
  return lines;
}

function pairDetails(pair: PairResult, expectedLabel: string): string[] {
  const head = `${pair.vacancyId} x ${pair.cvId}, run ${pair.run}`;
  if (pair.status === 'failed') {
    return [
      '<details>',
      `<summary>${head}: FAILED, ${pair.attempts} attempt(s)</summary>`,
      '',
      `Error: ${pair.error ?? 'unknown error'}`,
      '',
      '</details>',
      '',
    ];
  }
  const band = pair.band ?? 'n/a';
  const lines = [
    '<details>',
    `<summary>${head}: overall ${pair.overall} (${band}${expectedLabel}), ${pair.attempts} attempt(s)</summary>`,
    '',
    `Rationale: ${pair.rationale}`,
    '',
    `Tokens: ${pair.usage?.inputTokens ?? 0} in / ${pair.usage?.outputTokens ?? 0} out, ${usd(pair.costUsd)}. Grounded: ${pair.grounded?.ok ? 'yes' : 'NO'}.`,
    '',
    '| Criterion | Importance | Score | Reasoning | Quotes |',
    '| --- | --- | --- | --- | --- |',
    ...pair.criteria.map((c) => {
      const quotes =
        c.quotes.length === 0
          ? '_none_'
          : c.quotes.map((q) => `[${q.source}] "${cell(q.text)}"`).join('<br>');
      return `| ${c.id}: ${cell(c.text)} | ${c.importance} | ${c.score} | ${cell(c.reasoning)} | ${quotes} |`;
    }),
    '',
  ];
  if (pair.grounded && !pair.grounded.ok) {
    lines.push(
      '**Grounding problems**',
      ...pair.grounded.problems.map((p) => `- ${p}`),
      '',
    );
  }
  lines.push(
    '**Filler suspects**',
    pair.fillerSuspects.length === 0
      ? '_none_'
      : pair.fillerSuspects
          .map(
            (s) =>
              `- ${s.criterionId} (score 0) quotes "${s.quote}", also used for ${s.sharedWith.join(', ')}`,
          )
          .join('\n'),
    '',
    '</details>',
    '',
  );
  return lines;
}

export function renderMarkdown(result: EvalResult): string {
  const { pricing } = result;
  const t = computeTotals(result);
  const fixed = (v: number | null): string =>
    v === null ? 'n/a' : v.toFixed(1);

  const lines: string[] = [
    `# Score eval: ${result.label}`,
    '',
    `- Date: ${result.date}`,
    `- Model: ${result.model}`,
    `- Runs: ${result.runs}`,
    `- Pricing: $${pricing.inputPerMillion} / $${pricing.outputPerMillion} per 1M input / output tokens`,
    `- Caveat: ${PRICING_CAVEAT}`,
    '',
    '## Totals',
    '',
    `- Pairs: ${t.pairs} (${t.scored} scored, ${t.failed} failed)`,
    `- Grounded: ${t.grounded}/${t.scored} scored pairs (${pct(t.grounded, t.scored)})`,
    `- Failed: ${t.failed}/${t.pairs} (${pct(t.failed, t.pairs)})`,
    `- Retried (more than one attempt): ${t.retried}/${t.pairs} (${pct(t.retried, t.pairs)})`,
    `- Band agreement: ${t.bandMatches}/${t.bandExpected} pairs with an expectation (${pct(t.bandMatches, t.bandExpected)})`,
    `- Spread across runs: mean ${fixed(t.meanSpread)}, max ${fixed(t.maxSpread)} (${t.spreadPairs} pairs with 2+ scored runs)`,
    `- Extraction: ${t.extractionInput} in / ${t.extractionOutput} out tokens, ${usd(t.extractionCost)}`,
    `- Scoring: ${t.scoringInput} in / ${t.scoringOutput} out tokens, ${usd(t.scoringCost)}`,
    `- Total cost: ${usd(t.extractionCost + t.scoringCost)}`,
    '',
    '## Pair matrix',
    '',
    'Overall per run (e.g. `82/79`); ✓/✗ = expected band matched/missed in every run; `R` = a pair needed a retry; `F` = a run failed.',
    '',
    ...matrix(result),
    '',
    '## Vacancies',
    '',
  ];

  for (const vacancy of result.vacancies) {
    const extractions = result.extractions.filter(
      (e) => e.vacancyId === vacancy.id,
    );
    if (extractions.length === 0) continue;
    lines.push(
      `### ${vacancy.id}: ${vacancy.title}`,
      '',
      `${vacancy.requirementCount} requirement bullet(s) in the vacancy text.`,
      '',
    );
    for (const extraction of extractions)
      lines.push(...extractionBlock(extraction));
  }

  lines.push('## Pairs', '');
  for (const pair of result.pairs) {
    const expectedLabel =
      pair.expected === null ? '' : `, expected ${pair.expected}`;
    lines.push(...pairDetails(pair, expectedLabel));
  }

  return lines.join('\n');
}
