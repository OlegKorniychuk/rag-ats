/**
 * Live CV parse-quality eval (Checkpoint A). Reuses the production extractor,
 * GitHub fetcher and CV parser with no DB, server or queue.
 *
 *   npm run parse-eval -w apps/api -- --label baseline --runs 2
 *   npm run parse-eval -w apps/api -- --dry-run
 *   npm run parse-eval -w apps/api -- --rescore baseline
 *
 * Real OpenAI calls are made unless --dry-run is given. The API key is never
 * printed. Relative --manifest / --out-dir paths resolve from the repo root.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Logger } from '@nestjs/common';
import { CvTextExtractor, isPdf } from '../cv/cv-text-extractor.js';
import { GithubClient } from '../github/github-client.js';
import { GithubProfileFetcher } from '../github/github-profile-fetcher.js';
import { CvProfileParser } from '../llm/cv-profile-parser.js';
import { LlmClient, type LlmUsage } from '../llm/llm-client.js';
import { allChecksFailed, runChecks } from './parse-eval/checks.js';
import {
  costUsd,
  DEFAULT_PRICING,
  PRICING_CAVEAT,
  type Pricing,
} from './parse-eval/cost.js';
import { loadManifest } from './parse-eval/manifest.js';
import { renderMarkdown } from './parse-eval/report.js';
import { rescore } from './parse-eval/rescore.js';
import type { CvResult, EvalResult, RunResult } from './parse-eval/result.js';
import { fromRoot, loadEnv, parseNumber, UsageError } from './shared/cli.js';
import { fetchGithub } from './shared/github.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string' },
      runs: { type: 'string' },
      manifest: { type: 'string' },
      'out-dir': { type: 'string' },
      only: { type: 'string' },
      'input-price': { type: 'string' },
      'output-price': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      rescore: { type: 'string' },
    },
    strict: true,
  });

  const dryRun = values['dry-run'] ?? false;
  const label = values.label;
  if (!dryRun && values.rescore === undefined) {
    if (!label) throw new UsageError('--label <name> is required');
    if (!/^[A-Za-z0-9._-]+$/.test(label)) {
      throw new UsageError('--label may only contain letters, digits, . _ -');
    }
  }
  const runs = parseNumber('runs', values.runs, 1, true);
  const pricing: Pricing = {
    inputPerMillion: parseNumber(
      'input-price',
      values['input-price'],
      DEFAULT_PRICING.inputPerMillion,
    ),
    outputPerMillion: parseNumber(
      'output-price',
      values['output-price'],
      DEFAULT_PRICING.outputPerMillion,
    ),
  };
  const manifestPath = fromRoot(
    values.manifest ?? 'data/checkpoint-a/manifest.json',
  );
  const outDir = fromRoot(values['out-dir'] ?? 'docs/eval/checkpoint-a');

  const manifest = await loadManifest(manifestPath);

  // Re-check a saved eval against the current manifest: no env, no API calls.
  if (values.rescore !== undefined) {
    if (!/^[A-Za-z0-9._-]+$/.test(values.rescore)) {
      throw new UsageError('--rescore may only contain letters, digits, . _ -');
    }
    const jsonPath = join(outDir, `${values.rescore}.json`);
    const saved = JSON.parse(await readFile(jsonPath, 'utf8')) as EvalResult;
    const updated = rescore(saved, manifest);
    await writeFile(jsonPath, JSON.stringify(updated, null, 2) + '\n');
    await writeFile(
      join(outDir, `${values.rescore}.md`),
      renderMarkdown(updated),
    );
    const allRuns = updated.cvs.flatMap((r) => r.runs);
    const passed = allRuns.reduce((n, r) => n + r.checksPassed, 0);
    const total = allRuns.reduce((n, r) => n + r.checksTotal, 0);
    console.log(`Rescored "${values.rescore}": checks ${passed}/${total}`);
    return;
  }
  let cvs = manifest.cvs;
  if (values.only) {
    const ids = values.only
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = ids.filter((id) => !cvs.some((cv) => cv.id === id));
    if (unknown.length > 0) {
      throw new UsageError(`--only: unknown CV id(s): ${unknown.join(', ')}`);
    }
    cvs = cvs.filter((cv) => ids.includes(cv.id));
  }

  const env = loadEnv();
  // Keep the console to this script's own output plus warnings.
  Logger.overrideLogger(['warn', 'error']);

  const extractor = new CvTextExtractor();
  const fetcher = new GithubProfileFetcher(new GithubClient(env));

  // Only built for live runs, so a dry run can never reach OpenAI.
  let parser: CvProfileParser | null = null;
  let lastUsage: LlmUsage | null = null;
  if (!dryRun) {
    const llm = new LlmClient(env);
    const original = llm.parseStructured.bind(llm);
    llm.parseStructured = (async (params: Parameters<typeof original>[0]) => {
      const result = await original(params);
      lastUsage = result.usage;
      return result;
    }) as typeof llm.parseStructured;
    parser = new CvProfileParser(llm);
  }

  console.log(
    dryRun
      ? `Dry run: ${cvs.length} CV(s), no LLM calls`
      : `Eval "${label}": ${cvs.length} CV(s) x ${runs} run(s), model ${env.OPENAI_MODEL}`,
  );

  const results: CvResult[] = [];
  for (const cv of cvs) {
    const result: CvResult = {
      id: cv.id,
      file: cv.file,
      layout: cv.layout,
      language: cv.language,
      githubUrl: cv.githubUrl,
      githubStatus: 'none',
      textLength: null,
      error: null,
      runs: [],
    };
    results.push(result);

    let text: string;
    try {
      const buffer = await readFile(resolve(dirname(manifestPath), cv.file));
      if (!isPdf(buffer)) throw new Error('not a PDF');
      text = await extractor.extract(buffer);
    } catch (err) {
      result.error = `extraction failed: ${err instanceof Error ? err.message : String(err)}`;
      console.log(`${cv.id}: ${result.error}`);
      continue;
    }
    result.textLength = text.length;

    // Once per CV; reused across runs to save GitHub calls.
    const github = await fetchGithub(fetcher, cv.githubUrl);
    result.githubStatus = github.status;

    if (dryRun || !parser) {
      console.log(
        `${cv.id}: text ${text.length} chars, GitHub ${github.status}`,
      );
      continue;
    }

    for (let run = 1; run <= runs; run++) {
      lastUsage = null;
      const runResult: RunResult = {
        run,
        error: null,
        profile: null,
        usage: null,
        costUsd: 0,
        checks: [],
        checksPassed: 0,
        checksTotal: 0,
      };
      try {
        runResult.profile = await parser.parse(text, github.snapshot);
        const summary = runChecks(runResult.profile, cv.expect);
        runResult.checks = summary.results;
        runResult.checksPassed = summary.passed;
        runResult.checksTotal = summary.total;
      } catch (err) {
        runResult.error = err instanceof Error ? err.message : String(err);
        const summary = allChecksFailed(cv.expect);
        runResult.checks = summary.results;
        runResult.checksPassed = summary.passed;
        runResult.checksTotal = summary.total;
      }
      runResult.usage = lastUsage;
      runResult.costUsd = costUsd(lastUsage, pricing);
      result.runs.push(runResult);

      const tokens = runResult.usage
        ? `${runResult.usage.inputTokens} in / ${runResult.usage.outputTokens} out`
        : 'no usage';
      console.log(
        `${cv.id} run ${run}: ${runResult.error ? `ERROR (${runResult.error})` : `checks ${runResult.checksPassed}/${runResult.checksTotal}`}, ${tokens}, $${runResult.costUsd.toFixed(4)}`,
      );
    }
  }

  if (dryRun) return;

  const evalResult: EvalResult = {
    label: label!,
    model: env.OPENAI_MODEL,
    date: new Date().toISOString(),
    runsPerCv: runs,
    pricing,
    cvs: results,
  };
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, `${label}.json`);
  const mdPath = join(outDir, `${label}.md`);
  await writeFile(jsonPath, JSON.stringify(evalResult, null, 2) + '\n');
  await writeFile(mdPath, renderMarkdown(evalResult));

  const allRuns = results.flatMap((r) => r.runs);
  const passed = allRuns.reduce((s, r) => s + r.checksPassed, 0);
  const total = allRuns.reduce((s, r) => s + r.checksTotal, 0);
  const tokens = allRuns.reduce((s, r) => s + (r.usage?.totalTokens ?? 0), 0);
  const cost = allRuns.reduce((s, r) => s + r.costUsd, 0);
  console.log(
    `\nChecks ${passed}/${total}, ${tokens} tokens, $${cost.toFixed(4)}.`,
  );
  console.log(PRICING_CAVEAT);
  console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
