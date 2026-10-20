import { PRICING_CAVEAT } from './cost.js';
import type { CvResult, EvalResult, RunResult } from './result.js';

const usd = (value: number): string => `$${value.toFixed(4)}`;

const cell = (value: string): string => value.replace(/\|/g, '\\|');

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function withUsage(cv: CvResult): RunResult[] {
  return cv.runs.filter((r) => r.usage !== null);
}

function checksPerRun(cv: CvResult): string {
  if (cv.runs.length === 0) return cv.error ? 'error' : '-';
  return cv.runs
    .map((r) => (r.error ? 'err' : `${r.checksPassed}/${r.checksTotal}`))
    .join(', ');
}

function cvRow(cv: CvResult): string {
  const usageRuns = withUsage(cv);
  const avgIn = Math.round(average(usageRuns.map((r) => r.usage!.inputTokens)));
  const avgOut = Math.round(
    average(usageRuns.map((r) => r.usage!.outputTokens)),
  );
  const avgCost = average(cv.runs.map((r) => r.costUsd));
  return `| ${cell(cv.id)} | ${cell(cv.layout)} | ${cell(cv.language)} | ${cv.githubStatus} | ${checksPerRun(cv)} | ${avgIn} | ${avgOut} | ${usd(avgCost)} |`;
}

function list(items: string[]): string {
  return items.length === 0
    ? '_none_'
    : items.map((item) => `- ${item}`).join('\n');
}

function runBlock(run: RunResult): string {
  const header = `#### Run ${run.run}`;
  const checks = `Checks: ${run.checksPassed}/${run.checksTotal}`;
  const usage = run.usage
    ? `Tokens: ${run.usage.inputTokens} in / ${run.usage.outputTokens} out, ${usd(run.costUsd)}`
    : 'Tokens: n/a';
  if (!run.profile) {
    return `${header}\n\n${checks}. ${usage}\n\nNo profile: ${run.error ?? 'unknown error'}`;
  }
  return [
    header,
    `${checks}. ${usage}`,
    '**Skills**',
    list(run.profile.skills),
    '**Projects**',
    list(run.profile.projects),
    '**Experience**',
    run.profile.experience || '_empty_',
    '**Summary**',
    run.profile.summary || '_empty_',
  ].join('\n\n');
}

function detailsBlock(cv: CvResult): string {
  const text =
    cv.textLength === null
      ? 'extraction failed'
      : `${cv.textLength} chars extracted`;
  const parts = [
    `<details>`,
    `<summary>${cv.id} (${text}, GitHub: ${cv.githubStatus})</summary>`,
    '',
  ];
  if (cv.error) parts.push(`Error: ${cv.error}`, '');
  for (const run of cv.runs) parts.push(runBlock(run), '');
  parts.push('</details>');
  return parts.join('\n');
}

export function renderMarkdown(result: EvalResult): string {
  const { pricing } = result;
  const lines: string[] = [
    `# Parse eval: ${result.label}`,
    '',
    `- Model: ${result.model}`,
    `- Date: ${result.date}`,
    `- Runs per CV: ${result.runsPerCv}`,
    `- Pricing: $${pricing.inputPerMillion} / $${pricing.outputPerMillion} per 1M input / output tokens`,
    `- Caveat: ${PRICING_CAVEAT}`,
    '',
    '## Per-CV results',
    '',
    '| CV | Layout | Lang | GitHub | Checks per run | Avg in tokens | Avg out tokens | Avg cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...result.cvs.map(cvRow),
  ];

  const allRuns = result.cvs.flatMap((cv) => cv.runs);
  const inTokens = allRuns.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0);
  const outTokens = allRuns.reduce(
    (s, r) => s + (r.usage?.outputTokens ?? 0),
    0,
  );
  const cost = allRuns.reduce((s, r) => s + r.costUsd, 0);
  const passed = allRuns.reduce((s, r) => s + r.checksPassed, 0);
  const total = allRuns.reduce((s, r) => s + r.checksTotal, 0);
  const rate = total === 0 ? 'n/a' : `${((passed / total) * 100).toFixed(1)}%`;

  lines.push(
    `| **Total** | | | | ${passed}/${total} (${rate}) | ${inTokens} | ${outTokens} | ${usd(cost)} |`,
    '',
    `Total tokens: ${inTokens + outTokens} (${inTokens} in, ${outTokens} out). Total cost: ${usd(cost)}. Overall check pass rate: ${rate}.`,
    '',
    '## Failed checks',
    '',
  );

  const failures: string[] = [];
  for (const cv of result.cvs) {
    if (cv.error) failures.push(`- ${cv.id}: CV not processed (${cv.error})`);
    for (const run of cv.runs) {
      if (run.error) {
        failures.push(`- ${cv.id}, run ${run.run}: no profile (${run.error})`);
      }
      for (const check of run.checks) {
        if (!check.passed) {
          failures.push(
            `- ${cv.id}, run ${run.run}: ${check.kind} "${check.target}"`,
          );
        }
      }
    }
  }
  lines.push(failures.length === 0 ? '_none_' : failures.join('\n'), '');

  lines.push('## Profiles', '');
  for (const cv of result.cvs) lines.push(detailsBlock(cv), '');

  return lines.join('\n');
}
