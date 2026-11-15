import { parseArgs } from 'node:util';
import { parseNumber, UsageError } from '../shared/cli.js';

export const DEFAULT_MAX_USD = 3;
export const DEFAULT_TIMEOUT_MIN = 30;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_DIR = 'data/synthetic';

export const SEED_USAGE = [
  'Usage: db:seed [options]',
  '  --label <name>        report name (docs/eval/seed/<name>.{json,md}); required unless --dry-run',
  '  --dry-run             print the plan and the cost estimate, no DB, no LLM calls',
  `  --max-usd <n>         stop submitting when the spend plus queued work would pass n (default ${DEFAULT_MAX_USD})`,
  '  --only <ids>          comma-separated persona ids (a subset, e.g. a smoke run)',
  `  --dir <path>          synthetic data directory (default ${DEFAULT_DIR})`,
  '  --vacancies <path>    vacancies file (default <dir>/vacancies.json)',
  `  --timeout-min <n>     give up waiting for the drain after n minutes (default ${DEFAULT_TIMEOUT_MIN})`,
  `  --concurrency <n>     personas applying at once (default ${DEFAULT_CONCURRENCY})`,
].join('\n');

export interface SeedArgs {
  label: string | null;
  dryRun: boolean;
  maxUsd: number;
  only: string[] | null;
  dir: string;
  vacancies: string | null;
  timeoutMin: number;
  concurrency: number;
}

const LABEL_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Parses the CLI flags; a bad or missing flag throws `UsageError`. */
export function parseSeedArgs(argv: string[]): SeedArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'max-usd': { type: 'string' },
        only: { type: 'string' },
        dir: { type: 'string' },
        vacancies: { type: 'string' },
        'timeout-min': { type: 'string' },
        concurrency: { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const dryRun = values['dry-run'] ?? false;
  const label = values.label ?? null;
  if (!dryRun && !label) throw new UsageError('--label <name> is required');
  if (label !== null && !LABEL_PATTERN.test(label)) {
    throw new UsageError('--label may only contain letters, digits, . _ -');
  }

  let only: string[] | null = null;
  if (values.only !== undefined) {
    only = values.only
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (only.length === 0) throw new UsageError('--only needs persona ids');
  }

  const timeoutMin = parseNumber(
    'timeout-min',
    values['timeout-min'],
    DEFAULT_TIMEOUT_MIN,
  );
  if (timeoutMin <= 0) throw new UsageError('--timeout-min must be positive');

  return {
    label,
    dryRun,
    maxUsd: parseNumber('max-usd', values['max-usd'], DEFAULT_MAX_USD),
    only,
    dir: values.dir ?? DEFAULT_DIR,
    vacancies: values.vacancies ?? null,
    timeoutMin,
    concurrency: parseNumber('concurrency', values.concurrency, 4, true),
  };
}
