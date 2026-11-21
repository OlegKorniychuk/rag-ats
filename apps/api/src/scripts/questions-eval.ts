/**
 * The interview questions eval: generates questions for a stratified sample
 * of the seeded applications with a current fit score (strong / partial /
 * weak by the synthetic ground truth) and writes the metrics report plus a
 * review table for hand labelling.
 *
 *   npm run questions-eval -w apps/api -- --label q1 --dry-run
 *   npm run questions-eval -w apps/api -- --label q1 --max-usd 1
 *   npm run questions-eval -w apps/api -- --summarise-review docs/eval/questions/q1.review.md
 *
 * It runs in-process against `DATABASE_URL` (the seeded `rag_ats_seed`) with
 * the eval's slim context (no HTTP server, no job queue). It calls the
 * production `QuestionGenerator` directly and writes nothing to the
 * database. A dry run reads the database (read-only), prints the sample and
 * the estimate, and makes no LLM call. `--summarise-review` needs neither the
 * database nor the OpenAI key.
 *
 * Files, for a label `L` under docs/eval/questions/: L.json (records and
 * metrics), L.md (the metrics report) and L.review.md (the table to label;
 * never overwritten). `--summarise-review x.review.md` writes
 * x.review.summary.md. The API key and the database URL are never printed.
 *
 * Exit codes: 0 all good; 1 preflight problems or the budget stopped the run
 * (the files are still written); 2 usage error.
 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { loadSyntheticSet } from './eval/data.js';
import { loadEvalDataset } from './eval/dataset.js';
import { writeFormatted } from './eval/layout.js';
import { PreflightError } from './eval/preflight.js';
import { DEFAULT_PRICING } from './parse-eval/cost.js';
import {
  parseQuestionsEvalArgs,
  QUESTIONS_EVAL_USAGE,
  type QuestionsEvalArgs,
} from './questions-eval/args.js';
import {
  QuestionsReviewError,
  renderQuestionsReviewSummary,
  reviewSummaryPathOf,
  summariseQuestionsReview,
} from './questions-eval/review.js';
import {
  FIRST_CALL_ESTIMATE_USD,
  findQuestionsCandidates,
  QUESTIONS_EVAL_DIR,
  runQuestionsEval,
  writeQuestionsEvalFiles,
} from './questions-eval/run.js';
import { BANDS, sampleScoredApplications } from './questions-eval/sample.js';
import { SeedMeter } from './seed/metering.js';
import { fromRoot, loadEnv, UsageError } from './shared/cli.js';

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

async function summariseCommand(file: string): Promise<number> {
  const path = fromRoot(file);
  let markdown: string;
  try {
    markdown = renderQuestionsReviewSummary(
      summariseQuestionsReview(await readFile(path, 'utf8')),
    );
  } catch (err) {
    if (err instanceof QuestionsReviewError) throw new UsageError(err.message);
    throw new UsageError(`cannot read review file ${path}`);
  }
  const out = reviewSummaryPathOf(path);
  await writeFormatted(out, markdown, 'markdown');
  console.log(markdown);
  console.log(`Wrote ${out}`);
  return 0;
}

async function run(args: QuestionsEvalArgs): Promise<number> {
  const label = args.label!;
  const dir = fromRoot(QUESTIONS_EVAL_DIR);
  if (!args.dryRun && (await exists(join(dir, `${label}.review.md`)))) {
    throw new UsageError(
      `${join(dir, `${label}.review.md`)} already exists (it may hold labels); use another --label`,
    );
  }
  const set = await loadSyntheticSet();
  const env = loadEnv();
  // Keep the console to this script's own lines plus warnings.
  Logger.overrideLogger(['warn', 'error']);
  const meter = new SeedMeter(DEFAULT_PRICING);
  const { createEvalContext } = await import('./eval/app.js');
  const app = await createEvalContext({ env, meter });
  const startedAt = new Date().toISOString();
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
    const candidates = await findQuestionsCandidates(app, dataset);
    const items = sampleScoredApplications(candidates, args.perBand, args.seed);
    const byBand = BANDS.map(
      (band) =>
        `${band} ${items.filter((i) => i.band === band).length}/${candidates.filter((c) => c.band === band).length}`,
    ).join(', ');
    console.log(
      `Sample: ${items.length} scored application(s) (${byBand}; seed ${args.seed})`,
    );
    if (args.dryRun) {
      console.log(
        `Estimate: about $${(items.length * FIRST_CALL_ESTIMATE_USD).toFixed(2)} ($${FIRST_CALL_ESTIMATE_USD} per application, retries extra); cap $${args.maxUsd.toFixed(2)}. Dry run: no LLM calls, nothing written.`,
      );
      return 0;
    }

    const out = await runQuestionsEval(app, items, {
      maxUsd: args.maxUsd,
      meter,
      log: (line) => console.log(line),
    });
    const files = await writeQuestionsEvalFiles({
      dir,
      label,
      records: out.records,
      pricing: DEFAULT_PRICING,
      meta: {
        model: env.OPENAI_MODEL,
        perBand: args.perBand,
        seed: args.seed,
        spentUsd: meter.spentUsd,
        startedAt,
      },
      reviewCount: args.review,
    });
    const m = files.metrics;
    console.log(
      `\n${m.ok}/${m.applications} ok (${m.retried} retried, ${m.failed} failed); metered spend $${meter.spentUsd.toFixed(4)}`,
    );
    console.log(
      `Wrote ${files.jsonPath}\nWrote ${files.mdPath}\nWrote ${files.reviewPath}`,
    );
    if (out.stopped === 'budget') {
      console.error('Stopped on the budget cap; raise --max-usd to run all');
      return 1;
    }
    return 0;
  } finally {
    await app.close();
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(QUESTIONS_EVAL_USAGE);
    return 0;
  }
  const args = parseQuestionsEvalArgs(argv);
  if (args.summariseReview !== null) {
    return summariseCommand(args.summariseReview);
  }
  return run(args);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
