/**
 * Seeds a database with the synthetic data set (`data/synthetic/`): the seed
 * recruiter, the vacancies, and every persona's applications, then waits for
 * the parse / embed / score jobs to finish and writes a report.
 *
 *   npm run db:seed -w apps/api -- --dry-run
 *   npm run db:seed -w apps/api -- --label smoke --only p001,p002,p003
 *   npm run db:seed -w apps/api -- --label full --max-usd 3
 *
 * The app runs in-process (a standalone Nest context, no HTTP server), with
 * its pg-boss workers, against `DATABASE_URL`. GitHub data comes from
 * `<dir>/github/<username>.json` (`GITHUB_FIXTURES_DIR` is forced to it), so no
 * GitHub call is made. Real OpenAI calls are made unless `--dry-run` is given;
 * they are metered and capped by `--max-usd`. The seed recruiter is
 * `seed@example.com`; its password is `SEED_RECRUITER_PASSWORD` or the dev
 * default (neither is ever printed). Re-running resumes: pairs that already
 * exist are skipped. A dry run needs neither a DB nor the OpenAI key.
 *
 * Exit codes: 0 all good; 1 failures, timeout or budget stop (the report is
 * still written), or a dry run with missing input files; 2 usage error.
 * Relative paths resolve from the repo root.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { DEFAULT_PRICING } from './parse-eval/cost.js';
import { parseSeedArgs, SEED_USAGE } from './seed/args.js';
import { estimate, renderEstimate } from './seed/estimator.js';
import {
  existingFiles,
  loadPersonas,
  loadVacancies,
  selectPersonas,
} from './seed/inputs.js';
import { SeedMeter } from './seed/metering.js';
import { buildPlan, validateInputs } from './seed/planner.js';
import { buildReport, renderMarkdown } from './seed/report.js';
import { DEFAULT_SEED_PASSWORD, runSeed } from './seed/run.js';
import { fromRoot, loadEnv, UsageError } from './shared/cli.js';

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(SEED_USAGE);
    return 0;
  }
  const args = parseSeedArgs(argv);
  const dir = fromRoot(args.dir);

  const personas = selectPersonas(await loadPersonas(dir), args.only);
  const vacancies = await loadVacancies(dir, args.vacancies);

  // Preflight: everything the run reads must exist, listed all at once.
  const present = await existingFiles(dir, personas);
  const problems = validateInputs(personas, vacancies, (f) => present.has(f));
  const plan = buildPlan(personas, vacancies);

  if (args.dryRun) {
    console.log(
      `Dry run: ${plan.counts.personas} persona(s), ${plan.counts.applications} application(s) across ${plan.vacancyIds.length} vacancy(ies); no DB, no LLM calls`,
    );
    console.log(
      'Estimate for a fresh database (a re-run only does the missing work):',
    );
    console.log(renderEstimate(estimate(plan.counts), args.maxUsd));
    if (problems.length > 0) {
      // A dry run is the preflight: not ready means exit 1, after the estimate.
      console.error(`\nNot ready to seed:\n${problems.join('\n')}`);
      return 1;
    }
    console.log('\nAll input files are present.');
    return 0;
  }

  if (problems.length > 0) {
    throw new UsageError(`Cannot seed:\n${problems.join('\n')}`);
  }

  const env = loadEnv();
  // Keep the console to this script's own lines plus warnings.
  Logger.overrideLogger(['warn', 'error']);
  const meter = new SeedMeter(DEFAULT_PRICING);

  console.log(
    `Seeding "${args.label}": ${plan.counts.personas} persona(s), ${plan.counts.applications} application(s), scoring ${env.SCORING_MODE}, model ${env.OPENAI_MODEL}, cap $${args.maxUsd.toFixed(2)}`,
  );
  console.log(
    `Estimate for a fresh database: $${estimate(plan.counts).totalUsd.toFixed(2)} (with margin)`,
  );

  // Loaded lazily: importing the app module validates the env, which a dry run must not need.
  const { createSeedContext } = await import('./seed/app.js');
  const app = await createSeedContext({
    env: Object.assign(Object.create(Object.getPrototypeOf(env)), env, {
      GITHUB_FIXTURES_DIR: join(dir, 'github'),
    }),
    meter,
  });

  let result;
  try {
    result = await runSeed(app, {
      dir,
      personas,
      vacancies,
      recruiterPassword:
        process.env.SEED_RECRUITER_PASSWORD || DEFAULT_SEED_PASSWORD,
      maxUsd: args.maxUsd,
      timeoutMs: args.timeoutMin * 60_000,
      concurrency: args.concurrency,
      meter,
      log: (line) => console.log(line),
    });
  } finally {
    await app.close();
  }

  const report = buildReport({
    label: args.label!,
    date: new Date(),
    databaseUrl: env.DATABASE_URL,
    scoringMode: env.SCORING_MODE,
    model: env.OPENAI_MODEL,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    pricing: DEFAULT_PRICING,
    maxUsd: args.maxUsd,
    stopped: result.stopped,
    durationMs: result.durationMs,
    snapshot: result.snapshot,
    meter,
    submitErrors: result.submitErrors,
  });
  const outDir = fromRoot('docs/eval/seed');
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, `${args.label}.json`);
  const mdPath = join(outDir, `${args.label}.md`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile(mdPath, renderMarkdown(report));

  const { counts, costUsd, parseSuccessPct } = report;
  console.log(
    `\nParsed ${counts.parsed}/${counts.personas} (${parseSuccessPct?.toFixed(1) ?? 'n/a'}%), embedded ${counts.embedded}, scored ${counts.scored}/${counts.applications} (failed ${counts.failedScores}), cost $${costUsd.total.toFixed(4)}, stopped: ${report.stopped ?? 'no'}`,
  );
  console.log(`Wrote ${jsonPath}\nWrote ${mdPath}`);

  const clean =
    report.stopped === null &&
    result.submitErrors.length === 0 &&
    counts.failedParses === 0 &&
    counts.parsePending === 0 &&
    counts.failedScores === 0 &&
    counts.scoresPending === 0;
  return clean ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = err instanceof UsageError ? 2 : 1;
  });
