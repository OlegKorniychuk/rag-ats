import { parseArgs } from 'node:util';
import { UsageError } from '../shared/cli.js';
import { DEFAULT_NOISE, DEFAULT_WEAK } from './sample.js';
import { DEFAULT_CONCURRENCY, DEFAULT_MAX_USD } from './scoring.js';
import { SCORING_MODES, type ScoringMode } from './score-record.js';

export const EVAL_PARTS = ['retrieval', 'scoring', 'all'] as const;
export type EvalPart = (typeof EVAL_PARTS)[number];

export const EVAL_USAGE = [
  'Usage: eval [options]',
  '  --part retrieval|scoring|all   what to run (default all)',
  '  --modes full_text,rag          scoring modes (default both)',
  '  --label <name>                 run name (docs/eval/baseline/<name>.{json,md} and <name>/); required unless --dry-run',
  '  --seed <n>                     sample and bootstrap seed (default 1)',
  `  --weak <n>                     weak pairs drawn at random (default ${DEFAULT_WEAK})`,
  `  --noise <n>                    pairs scored a second time per mode (default ${DEFAULT_NOISE})`,
  '  --limit <n>                    only the first n sampled pairs (smoke runs)',
  `  --concurrency <n>              scores in flight at once (default ${DEFAULT_CONCURRENCY})`,
  `  --max-usd <n>                  stop starting scores when spend plus in-flight estimates reach n (default ${DEFAULT_MAX_USD})`,
  '  --dry-run                      print the plan and the cost estimate, no LLM calls, nothing written',
  '  --retry-failed                 score again the jobs that failed (default: keep the failure)',
  '  --report-only                  rebuild <label>.{json,md} from the files in the label directory (no DB, no LLM)',
  '  --write-review --sample <n>    write review-<mode>.md with n random citations per mode (no DB, no LLM)',
  '  --summarise-review <file>      print and write the summary of a filled-in review file',
].join('\n');

export type EvalCommand =
  'run' | 'dry-run' | 'report-only' | 'write-review' | 'summarise-review';

export interface EvalArgs {
  command: EvalCommand;
  part: EvalPart;
  modes: ScoringMode[];
  label: string | null;
  seed: number;
  weak: number;
  noise: number;
  limit: number | null;
  concurrency: number;
  maxUsd: number;
  retryFailed: boolean;
  /** `--write-review`: citations per mode. */
  sample: number | null;
  /** `--summarise-review`: the review file. */
  summariseFile: string | null;
}

const LABEL_PATTERN = /^[A-Za-z0-9._-]+$/;

function numberFlag(
  name: string,
  raw: string | undefined,
  fallback: number,
  kind: 'nonneg-int' | 'positive-int' | 'positive',
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const ok =
    raw.trim() !== '' &&
    Number.isFinite(value) &&
    (kind === 'nonneg-int'
      ? Number.isInteger(value) && value >= 0
      : kind === 'positive-int'
        ? Number.isInteger(value) && value >= 1
        : value > 0);
  if (!ok) {
    throw new UsageError(
      `--${name} must be ${
        kind === 'nonneg-int'
          ? 'a non-negative integer'
          : kind === 'positive-int'
            ? 'a positive integer'
            : 'a positive number'
      }`,
    );
  }
  return value;
}

function parseModes(raw: string | undefined): ScoringMode[] {
  if (raw === undefined) return [...SCORING_MODES];
  const modes: ScoringMode[] = [];
  for (const part of raw.split(',').map((s) => s.trim())) {
    if (!(SCORING_MODES as readonly string[]).includes(part)) {
      throw new UsageError(
        `--modes: unknown mode "${part}" (allowed: ${SCORING_MODES.join(', ')})`,
      );
    }
    if (!modes.includes(part as ScoringMode)) modes.push(part as ScoringMode);
  }
  return modes;
}

/** Parses the CLI flags; a bad or missing flag throws `UsageError`. */
export function parseEvalArgs(argv: string[]): EvalArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        part: { type: 'string' },
        modes: { type: 'string' },
        label: { type: 'string' },
        seed: { type: 'string' },
        weak: { type: 'string' },
        noise: { type: 'string' },
        limit: { type: 'string' },
        concurrency: { type: 'string' },
        'max-usd': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'retry-failed': { type: 'boolean', default: false },
        'report-only': { type: 'boolean', default: false },
        'write-review': { type: 'boolean', default: false },
        sample: { type: 'string' },
        'summarise-review': { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const part = values.part ?? 'all';
  if (!(EVAL_PARTS as readonly string[]).includes(part)) {
    throw new UsageError(
      `--part must be one of ${EVAL_PARTS.join(', ')} (got "${part}")`,
    );
  }

  const commands: EvalCommand[] = [];
  if (values['dry-run']) commands.push('dry-run');
  if (values['report-only']) commands.push('report-only');
  if (values['write-review']) commands.push('write-review');
  if (values['summarise-review'] !== undefined) {
    commands.push('summarise-review');
  }
  if (commands.length > 1) {
    throw new UsageError(
      '--dry-run, --report-only, --write-review and --summarise-review cannot be combined',
    );
  }
  const command: EvalCommand = commands[0] ?? 'run';

  const label = values.label ?? null;
  if (label !== null && !LABEL_PATTERN.test(label)) {
    throw new UsageError('--label may only contain letters, digits, . _ -');
  }
  if (command !== 'dry-run' && command !== 'summarise-review' && !label) {
    throw new UsageError('--label <name> is required');
  }

  if (values.sample !== undefined && command !== 'write-review') {
    throw new UsageError('--sample is only used with --write-review');
  }
  if (command === 'write-review' && values.sample === undefined) {
    throw new UsageError('--write-review needs --sample <n>');
  }
  const summariseFile = values['summarise-review'] ?? null;
  if (summariseFile !== null && summariseFile.trim() === '') {
    throw new UsageError('--summarise-review needs a file path');
  }

  return {
    command,
    part: part as EvalPart,
    modes: parseModes(values.modes),
    label,
    seed: numberFlag('seed', values.seed, 1, 'nonneg-int'),
    weak: numberFlag('weak', values.weak, DEFAULT_WEAK, 'nonneg-int'),
    noise: numberFlag('noise', values.noise, DEFAULT_NOISE, 'nonneg-int'),
    limit:
      values.limit === undefined
        ? null
        : numberFlag('limit', values.limit, 0, 'positive-int'),
    concurrency: numberFlag(
      'concurrency',
      values.concurrency,
      DEFAULT_CONCURRENCY,
      'positive-int',
    ),
    maxUsd: numberFlag(
      'max-usd',
      values['max-usd'],
      DEFAULT_MAX_USD,
      'positive',
    ),
    retryFailed: values['retry-failed'] ?? false,
    sample:
      values.sample === undefined
        ? null
        : numberFlag('sample', values.sample, 0, 'positive-int'),
    summariseFile,
  };
}
