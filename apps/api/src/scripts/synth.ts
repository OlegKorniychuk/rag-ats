/**
 * Synthetic data pipeline (Stage 2, step 10). Each stage is a subcommand and
 * only reads and writes files under data/synthetic/.
 *
 *   npm run synth -w apps/api -- personas --seed 1 [--force]
 *   npm run synth -w apps/api -- labels
 *
 * To add a stage (vacancies, cvs, github, render, spot-check), implement
 * `run<Stage>(argv, dir)` in synth/stages/ and register it in STAGES below.
 * `--dir <path>` (before or after the subcommand's own flags) overrides the
 * data directory; relative paths resolve from the repo root.
 */
import 'reflect-metadata'; // shared/cli.js pulls in decorated env config
import { fromRoot, UsageError } from './shared/cli.js';
import { extractDir } from './synth/args.js';
import { SYNTH_DIR } from './synth/io.js';
import { CVS_USAGE, runCvs } from './synth/stages/cvs.js';
import { GITHUB_USAGE, runGithub } from './synth/stages/github.js';
import { LABELS_USAGE, runLabels } from './synth/stages/labels.js';
import { PERSONAS_USAGE, runPersonas } from './synth/stages/personas.js';
import { runVacancies, VACANCIES_USAGE } from './synth/stages/vacancies.js';
import { RENDER_USAGE, runRender } from './synth/stages/render.js';
import { runSpotCheck, SPOT_CHECK_USAGE } from './synth/stages/spot-check.js';

interface Stage {
  usage: string;
  run(argv: string[], dir: string): Promise<void>;
}

// Extension point: add the LLM and render stages here.
const STAGES: Record<string, Stage> = {
  personas: { usage: PERSONAS_USAGE, run: runPersonas },
  labels: { usage: LABELS_USAGE, run: runLabels },
  vacancies: { usage: VACANCIES_USAGE, run: runVacancies },
  cvs: { usage: CVS_USAGE, run: runCvs },
  github: { usage: GITHUB_USAGE, run: runGithub },
  render: { usage: RENDER_USAGE, run: runRender },
  'spot-check': { usage: SPOT_CHECK_USAGE, run: runSpotCheck },
};

function usage(): string {
  return [
    'Usage: synth <stage> [options]   (global: --dir <path>)',
    '',
    ...Object.values(STAGES).map((s) => s.usage),
  ].join('\n');
}

async function main(): Promise<void> {
  const [stageName, ...rest] = process.argv.slice(2);
  if (!stageName || stageName === '--help' || stageName === '-h') {
    console.log(usage());
    return;
  }
  const stage = STAGES[stageName];
  if (!stage) {
    throw new UsageError(`Unknown stage "${stageName}"\n\n${usage()}`);
  }

  const { dir, args } = extractDir(rest);
  await stage.run(args, dir ? fromRoot(dir) : SYNTH_DIR);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
