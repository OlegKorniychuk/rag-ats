/**
 * The eval harness: measures retrieval (candidate search, find matches) and
 * score agreement (full_text and rag scoring) of the seeded database against
 * the synthetic ground truth, and writes the baseline report.
 *
 *   npm run eval -w apps/api -- --dry-run
 *   npm run eval -w apps/api -- --part retrieval --label retrieval-1
 *   npm run eval -w apps/api -- --part scoring --label baseline --limit 10
 *   npm run eval -w apps/api -- --label baseline --max-usd 6
 *   npm run eval -w apps/api -- --label baseline --report-only
 *   npm run eval -w apps/api -- --label baseline --write-review --sample 40
 *   npm run eval -w apps/api -- --summarise-review docs/eval/baseline/baseline/review-rag.md
 *
 * It runs in-process against `DATABASE_URL` (the seeded `rag_ats_seed`): a
 * slim Nest context with the database, the LLM client and the search service,
 * no HTTP server and no job queue, and it writes nothing to the database.
 * Retrieval costs a few cents of embeddings; scoring makes real OpenAI calls
 * (metered, capped by `--max-usd`), unless `--dry-run`. A dry run prints the
 * plan and the estimate, then checks the seeded database (read-only) and makes
 * no LLM call. `--report-only`, `--write-review` and `--summarise-review` need
 * neither the database nor the OpenAI key.
 *
 * Files, for a label `L` under docs/eval/baseline/: L/retrieval.json,
 * L/scores.jsonl (the resumable cache), L/run-log.json, L/review-<mode>.md,
 * and the aggregate L.json and L.md, rebuilt on every invocation from what is
 * in L/ (so `--part retrieval` then `--part scoring` give one report). The
 * API key and the database URL are never printed. Relative paths resolve from
 * the repo root.
 *
 * Exit codes: 0 all good; 1 preflight problems, or the budget stopped the run
 * (the files are still written); 2 usage error.
 */
import { access, readFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';
import { DEFAULT_PRICING } from './parse-eval/cost.js';
import { parseEvalArgs, EVAL_USAGE, type EvalArgs } from './eval/args.js';
import {
  rebuildBaseline,
  sampleFromSet,
  type RebuildResult,
} from './eval/baseline.js';
import { readScoreCache } from './eval/cache.js';
import { loadSyntheticSet, type SyntheticSet } from './eval/data.js';
import { loadEvalDataset } from './eval/dataset.js';
import {
  appendRunLog,
  baselinePaths,
  BASELINE_DIR,
  readRunLog,
  writeFormatted,
  writeRetrieval,
  type BaselinePaths,
  type RunLogEntry,
} from './eval/layout.js';
import { PreflightError } from './eval/preflight.js';
import { retrievalEmbedCalls } from './eval/retrieval-plan.js';
import { runRetrievalEval } from './eval/retrieval.js';
import {
  buildReviewStub,
  parseReview,
  renderReviewSummary,
  ReviewError,
  summariseReview,
  summaryPathOf,
} from './eval/review.js';
import { pickNoiseSubset } from './eval/sample.js';
import { planScoringEval, runScoringEval } from './eval/scoring.js';
import type { ScoringRunResult } from './eval/scoring.js';
import { SeedMeter } from './seed/metering.js';
import { fromRoot, loadEnv, UsageError } from './shared/cli.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const num = (x: number | null | undefined): string =>
  x === null || x === undefined ? 'n/a' : x.toFixed(3);

const wantsRetrieval = (args: EvalArgs): boolean => args.part !== 'scoring';
const wantsScoring = (args: EvalArgs): boolean => args.part !== 'retrieval';

function printAggregate(result: RebuildResult): void {
  const { aggregate } = result;
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  const scoring = aggregate.scoring;
  if (scoring) {
    for (const [mode, agg] of Object.entries(scoring.perMode)) {
      if (!agg) continue;
      const a = agg.agreement;
      console.log(
        `${mode}: ${a.n}/${agg.coverage.sampled} scored (${agg.coverage.failed} failed, ${agg.coverage.missing} not run), rho ${num(a.spearman.estimate)}, MAE ${num(a.mae.estimate)}, kappa ${num(a.kappa.estimate)}`,
      );
    }
  }
  const search = aggregate.retrieval?.search;
  if (search) {
    console.log(
      `search: nDCG@10 ${num(search.metrics.ndcg10)}, P@10 ${num(search.metrics.p10)}, R@20 ${num(search.metrics.r20)}`,
    );
  }
  console.log(`Wrote ${result.jsonPath}\nWrote ${result.mdPath}`);
}

async function rebuild(
  args: EvalArgs,
  set: SyntheticSet,
  scored: boolean,
): Promise<RebuildResult> {
  return rebuildBaseline({
    baselineDir: fromRoot(BASELINE_DIR),
    label: args.label!,
    set,
    params: { seed: args.seed, weak: args.weak, noise: args.noise },
    scored,
  });
}

function labelPaths(args: EvalArgs): BaselinePaths {
  return baselinePaths(fromRoot(BASELINE_DIR), args.label!);
}

// ---------- review commands ----------

async function summariseReviewCommand(args: EvalArgs): Promise<number> {
  const path = fromRoot(args.summariseFile!);
  let markdown: string;
  try {
    markdown = renderReviewSummary(
      summariseReview(parseReview(await readFile(path, 'utf8'))),
    );
  } catch (err) {
    if (err instanceof ReviewError) throw new UsageError(err.message);
    throw new UsageError(`cannot read review file ${path}`);
  }
  const out = summaryPathOf(path);
  await writeFormatted(out, markdown, 'markdown');
  console.log(markdown);
  console.log(`Wrote ${out}`);
  if (args.label) {
    // The aggregate picks the filled-in reviews up.
    printAggregate(await rebuild(args, await loadSyntheticSet(), false));
  }
  return 0;
}

async function writeReviewCommand(
  args: EvalArgs,
  set: SyntheticSet,
): Promise<number> {
  const paths = labelPaths(args);
  const cache = await readScoreCache(paths.scores);
  if (cache.byKey.size === 0) {
    throw new UsageError(`No scores in ${paths.scores}: run scoring first`);
  }
  const records = [...cache.byKey.values()];
  for (const mode of args.modes) {
    const path = paths.review(mode);
    if (await exists(path)) {
      throw new UsageError(
        `${path} already exists; delete it to draw a new sample (it may hold labels)`,
      );
    }
    const stub = buildReviewStub(records, mode, args.sample!, args.seed);
    if (stub.rows === 0) {
      console.log(`${mode}: no citations in ok run-1 scores, nothing written`);
      continue;
    }
    await writeFormatted(path, stub.markdown, 'markdown');
    console.log(
      `${mode}: ${stub.rows} of ${stub.available} citations (seed ${args.seed}) -> ${path}`,
    );
  }
  printAggregate(await rebuild(args, set, false));
  return 0;
}

// ---------- dry run ----------

async function dryRun(args: EvalArgs, set: SyntheticSet): Promise<number> {
  const sample = sampleFromSet(set, args);
  const noise = pickNoiseSubset(sample.pairs, args.noise, args.seed);
  console.log(
    `Dry run: sample of ${sample.pairs.length} pair(s) (strong ${sample.sampled.strong}, partial ${sample.sampled.partial}, weak ${sample.sampled.weak}; seed ${args.seed}), ${noise.length} scored a second time per mode; no LLM calls, nothing written`,
  );
  if (wantsRetrieval(args)) {
    console.log(
      `Retrieval: ${retrievalEmbedCalls(set)} embedding call(s) (${set.queries.length} search queries, 2 find-matches modes x ${set.vacancies.length} vacancies), under $0.01`,
    );
  }
  if (wantsScoring(args)) {
    const plan = await planScoringEval({
      pairs: sample.pairs,
      noise,
      modes: args.modes,
      ...(args.limit !== null && { limit: args.limit }),
      shuffleSeed: args.seed,
      retryFailed: args.retryFailed,
      ...(args.label && { cachePath: labelPaths(args).scores }),
    });
    console.log(
      `Scoring: ${plan.jobs} job(s) (run 1: ${plan.byRun[1]}, run 2: ${plan.byRun[2]}; full_text ${plan.byMode.full_text}, rag ${plan.byMode.rag}), ${plan.cachedOk} cached ok, ${plan.cachedFailed} cached failed, ${plan.toRun} to run`,
    );
    console.log(
      `Estimate: $${plan.estimateUsd.toFixed(2)} for the jobs to run ($${plan.unitUsd} x ${plan.margin} margin each), $${plan.totalEstimateUsd.toFixed(2)} for all of them; cap $${args.maxUsd.toFixed(2)}`,
    );
  }

  // Read-only check of the seeded database (no LLM call).
  const env = loadEnv();
  Logger.overrideLogger(['warn', 'error']);
  const { createEvalContext } = await import('./eval/app.js');
  const app = await createEvalContext({
    env,
    meter: new SeedMeter(DEFAULT_PRICING),
  });
  try {
    await loadEvalDataset(app, set);
  } catch (err) {
    if (err instanceof PreflightError) {
      console.error(`\n${err.message}`);
      return 1;
    }
    throw err;
  } finally {
    await app.close();
  }
  console.log(
    '\nPreflight ok: the seeded database holds every persona and vacancy.',
  );
  return 0;
}

// ---------- live run ----------

async function liveRun(args: EvalArgs, set: SyntheticSet): Promise<number> {
  const paths = labelPaths(args);
  const env = loadEnv();
  // Keep the console to this script's own lines plus warnings.
  Logger.overrideLogger(['warn', 'error']);
  const meter = new SeedMeter(DEFAULT_PRICING);
  const { createEvalContext } = await import('./eval/app.js');
  const app = await createEvalContext({ env, meter });

  const startedAt = new Date();
  let scoringResult: ScoringRunResult | null = null;
  let started = false;
  try {
    let dataset;
    try {
      dataset = await loadEvalDataset(app, set);
    } catch (err) {
      if (err instanceof PreflightError) {
        console.error(err.message);
        return 1;
      }
      throw err;
    }
    started = true;

    if (wantsRetrieval(args)) {
      console.log('Retrieval eval: embedding the queries and ranking');
      const retrieval = await runRetrievalEval(app, dataset);
      await writeRetrieval(paths, retrieval);
      console.log(`Retrieval eval: wrote ${paths.retrieval}`);
    }
    if (wantsScoring(args)) {
      const sample = sampleFromSet(set, args);
      const noise = pickNoiseSubset(sample.pairs, args.noise, args.seed);
      scoringResult = await runScoringEval(app, dataset, {
        pairs: sample.pairs,
        noise,
        modes: args.modes,
        ...(args.limit !== null && { limit: args.limit }),
        shuffleSeed: args.seed,
        cachePath: paths.scores,
        concurrency: args.concurrency,
        maxUsd: args.maxUsd,
        retryFailed: args.retryFailed,
        meter,
        log: (line) => console.log(line),
      });
    }
  } finally {
    await app.close();
    if (started) {
      const entry: RunLogEntry = {
        part: args.part,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        modes: wantsScoring(args) ? args.modes : [],
        seed: args.seed,
        weak: args.weak,
        noise: args.noise,
        limit: args.limit,
        concurrency: args.concurrency,
        maxUsd: args.maxUsd,
        retryFailed: args.retryFailed,
        spentUsd: meter.spentUsd,
        stopped: scoringResult?.stopped ?? null,
        scoring: scoringResult ? { ...scoringResult.counts } : null,
      };
      await appendRunLog(paths, entry);
    }
  }

  console.log(`\nMetered spend of this run: $${meter.spentUsd.toFixed(4)}`);
  if (scoringResult && scoringResult.corruptCacheLines > 0) {
    console.warn(
      `Warning: ${scoringResult.corruptCacheLines} unreadable line(s) in the cache were skipped`,
    );
  }
  printAggregate(await rebuild(args, set, wantsScoring(args)));
  if (scoringResult?.stopped === 'budget') {
    console.error(
      `Stopped on the budget cap with ${scoringResult.counts.notStarted} job(s) not started; run again (the cache resumes) with a higher --max-usd`,
    );
    return 1;
  }
  if (scoringResult && scoringResult.counts.failed > 0) {
    console.log(
      `${scoringResult.counts.failed} job(s) failed and are cached as failures; --retry-failed scores them again`,
    );
  }
  return 0;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(EVAL_USAGE);
    return 0;
  }
  const args = parseEvalArgs(argv);

  if (args.command === 'summarise-review') return summariseReviewCommand(args);

  const set = await loadSyntheticSet();
  if (args.command === 'dry-run') return dryRun(args, set);

  const paths = labelPaths(args);
  if (args.command === 'report-only') {
    if (!(await exists(paths.dir))) {
      throw new UsageError(`Nothing to report: ${paths.dir} does not exist`);
    }
    const runs = await readRunLog(paths);
    printAggregate(await rebuild(args, set, false));
    console.log(`(${runs.length} logged invocation(s))`);
    return 0;
  }
  if (args.command === 'write-review') return writeReviewCommand(args, set);
  return liveRun(args, set);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
