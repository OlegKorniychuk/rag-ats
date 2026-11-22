import { parseArgs } from 'node:util';
import { DEFAULT_PRICING, type Pricing } from '../parse-eval/cost.js';
import { UsageError } from '../shared/cli.js';

export const QUESTIONS_EVAL_DEFAULTS = {
  maxUsd: 1,
  perBand: 10,
  review: 25,
  seed: 42,
};

export const QUESTIONS_EVAL_USAGE = [
  'Usage: questions-eval [options]',
  '  --label <name>               run name (docs/eval/questions/<name>.{json,md}, <name>.review.md); required',
  `  --per-band <n>               scored applications sampled per band (default ${QUESTIONS_EVAL_DEFAULTS.perBand})`,
  `  --review <n>                 questions in the review table (default ${QUESTIONS_EVAL_DEFAULTS.review})`,
  `  --seed <n>                   sample seed (default ${QUESTIONS_EVAL_DEFAULTS.seed})`,
  `  --max-usd <n>                stop before a call that would pass n (default ${QUESTIONS_EVAL_DEFAULTS.maxUsd})`,
  '  --input-price <n>            USD per 1M input tokens (default 0.75, gpt-5.4-mini)',
  '  --output-price <n>           USD per 1M output tokens (default 4.5, gpt-5.4-mini)',
  '  --dry-run                    print the sample and the estimate (reads the DB), no LLM calls, nothing written',
  '  --summarise-review <file>    count the labels of a filled-in review file (no DB, no LLM)',
].join('\n');

export interface QuestionsEvalArgs {
  label: string | null;
  dryRun: boolean;
  maxUsd: number;
  perBand: number;
  review: number;
  seed: number;
  summariseReview: string | null;
  /** Chat prices for metering and report costs. */
  pricing: Pricing;
}

const LABEL_PATTERN = /^[A-Za-z0-9._-]+$/;

function numberFlag(
  name: string,
  raw: string | undefined,
  fallback: number,
  kind: 'positive-int' | 'nonneg-int' | 'positive',
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  const ok =
    raw.trim() !== '' &&
    Number.isFinite(value) &&
    (kind === 'positive-int'
      ? Number.isInteger(value) && value >= 1
      : kind === 'nonneg-int'
        ? Number.isInteger(value) && value >= 0
        : value > 0);
  if (!ok) {
    throw new UsageError(
      `--${name} must be ${
        kind === 'positive-int'
          ? 'a positive integer'
          : kind === 'nonneg-int'
            ? 'a non-negative integer'
            : 'a positive number'
      }`,
    );
  }
  return value;
}

/** Parses the CLI flags; a bad or missing flag throws `UsageError`. */
export function parseQuestionsEvalArgs(argv: string[]): QuestionsEvalArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        'per-band': { type: 'string' },
        review: { type: 'string' },
        seed: { type: 'string' },
        'max-usd': { type: 'string' },
        'input-price': { type: 'string' },
        'output-price': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'summarise-review': { type: 'string' },
      },
      strict: true,
    }));
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }

  const summariseReview = values['summarise-review'] ?? null;
  const label = values.label ?? null;
  if (summariseReview === null && label === null) {
    throw new UsageError('--label is required');
  }
  if (label !== null && !LABEL_PATTERN.test(label)) {
    throw new UsageError('--label may only use letters, digits, ".", "_", "-"');
  }
  return {
    label,
    dryRun: values['dry-run'] ?? false,
    maxUsd: numberFlag(
      'max-usd',
      values['max-usd'],
      QUESTIONS_EVAL_DEFAULTS.maxUsd,
      'positive',
    ),
    perBand: numberFlag(
      'per-band',
      values['per-band'],
      QUESTIONS_EVAL_DEFAULTS.perBand,
      'positive-int',
    ),
    review: numberFlag(
      'review',
      values.review,
      QUESTIONS_EVAL_DEFAULTS.review,
      'nonneg-int',
    ),
    seed: numberFlag(
      'seed',
      values.seed,
      QUESTIONS_EVAL_DEFAULTS.seed,
      'nonneg-int',
    ),
    summariseReview,
    pricing: {
      inputPerMillion: numberFlag(
        'input-price',
        values['input-price'],
        DEFAULT_PRICING.inputPerMillion,
        'positive',
      ),
      outputPerMillion: numberFlag(
        'output-price',
        values['output-price'],
        DEFAULT_PRICING.outputPerMillion,
        'positive',
      ),
    },
  };
}
