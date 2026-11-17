/**
 * Shared machinery of the LLM stages (`vacancies`, `cvs`, `github`): flags,
 * the target plan, the budget guard, the retry loop, the worker pool, dry-run
 * estimates and `generation-log.json`.
 *
 * Retry policy per item: attempt, drift check; up to 2 retries with the
 * problems as feedback; then up to 2 fresh attempts without feedback; then a
 * recorded failure. A failing output is never written and the spec is never
 * changed to fit the text.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { z } from 'zod';
import {
  LlmClient,
  type LlmUsage,
  type ParseStructuredParams,
  type ParseStructuredResult,
} from '../../llm/llm-client.js';
import {
  costUsd,
  DEFAULT_PRICING,
  PRICING_CAVEAT,
} from '../parse-eval/cost.js';
import { UsageMeter } from '../score-eval/meter.js';
import { loadEnv, parseNumber, UsageError } from '../shared/cli.js';
import { exists, readJson, writeJson } from './io.js';
import type { Prompt } from './prompts/common.js';

/** The real client; only built for live runs (needs OPENAI_API_KEY). */
export function liveLlm(): SynthLlm {
  return new LlmClient(loadEnv());
}

/** Test seam: stages take an optional client instead of building one. */
export interface StageDeps {
  llm?: SynthLlm;
}

/** The part of `LlmClient` the stages use (tests pass a fake). */
export interface SynthLlm {
  model: string;
  parseStructured<S extends z.ZodType>(
    params: ParseStructuredParams<S>,
  ): Promise<ParseStructuredResult<z.infer<S>>>;
}

export const MAX_FEEDBACK_RETRIES = 2;
export const MAX_FRESH_ATTEMPTS = 2;
export const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_MAX_USD = 2;
/** Dry run: share of extra calls expected from drift retries. */
export const DRY_RUN_RETRY_FACTOR = 1.3;

// ---------------------------------------------------------------- flags

export interface CommonFlags {
  concurrency: number;
  maxUsd: number;
  dryRun: boolean;
}

export const COMMON_OPTIONS = {
  concurrency: { type: 'string' },
  'max-usd': { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
} as const;

export function commonFlags(values: {
  concurrency?: string;
  'max-usd'?: string;
  'dry-run'?: boolean;
}): CommonFlags {
  return {
    concurrency: parseNumber(
      'concurrency',
      values.concurrency,
      DEFAULT_CONCURRENCY,
      true,
    ),
    maxUsd: parseNumber('max-usd', values['max-usd'], DEFAULT_MAX_USD),
    dryRun: values['dry-run'] ?? false,
  };
}

export interface PersonaFlags extends CommonFlags {
  only: string[] | null;
  /** `all`, a set of ids, or none. */
  force: 'all' | Set<string>;
}

const splitIds = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Flags of the per-persona stages (`cvs`, `github`). */
export function parsePersonaFlags(argv: string[]): PersonaFlags {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: 'string' },
      force: { type: 'string' },
      ...COMMON_OPTIONS,
    },
    strict: true,
  });
  const force = values.force;
  return {
    ...commonFlags(values),
    only: values.only !== undefined ? splitIds(values.only) : null,
    force:
      force === undefined
        ? new Set()
        : force.trim() === 'all'
          ? 'all'
          : new Set(splitIds(force)),
  };
}

export interface Plan {
  /** Ids to generate, in input order. */
  todo: string[];
  /** Ids that already have an output and are left alone. */
  skipped: string[];
}

/**
 * Which ids need generating: the `--only` subset (default all candidates)
 * minus those with an output, unless forced. Unknown ids are a usage error.
 */
export function planTargets(
  candidates: string[],
  hasOutput: (id: string) => Promise<boolean> | boolean,
  flags: Pick<PersonaFlags, 'only' | 'force'>,
): Promise<Plan> {
  return (async () => {
    const known = new Set(candidates);
    const named = [
      ...(flags.only ?? []),
      ...(flags.force === 'all' ? [] : flags.force),
    ];
    const unknown = named.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new UsageError(
        `Unknown or ineligible id(s): ${unknown.join(', ')}`,
      );
    }
    const only = flags.only ? new Set(flags.only) : null;
    const todo: string[] = [];
    const skipped: string[] = [];
    for (const id of candidates) {
      if (only && !only.has(id)) continue;
      const forced = flags.force === 'all' || flags.force.has(id);
      if (!forced && (await hasOutput(id))) skipped.push(id);
      else todo.push(id);
    }
    return { todo, skipped };
  })();
}

// ------------------------------------------------------------- estimates

export const estimateUsd = (
  inputTokens: number,
  outputTokens: number,
): number =>
  costUsd(
    { model: 'estimate', inputTokens, outputTokens, totalTokens: 0 },
    DEFAULT_PRICING,
  );

/** Rough token count of a prompt: about 4 characters per token. */
export const promptTokens = (p: Prompt): number =>
  Math.ceil((p.system.length + p.user.length) / 4);

export interface EstimateItem {
  id: string;
  inputTokens: number;
  outputTokens: number;
}

export function printDryRun(
  stage: string,
  items: EstimateItem[],
  skipped: number,
  maxUsd: number,
): void {
  const inTok = items.reduce((n, i) => n + i.inputTokens, 0);
  const outTok = items.reduce((n, i) => n + i.outputTokens, 0);
  const base = estimateUsd(inTok, outTok);
  const expected = base * DRY_RUN_RETRY_FACTOR;
  const calls = items.length;
  console.log(
    [
      `Dry run (${stage}): no LLM client, no API key, no files written.`,
      `  to generate: ${calls} (${skipped} already have an output)`,
      `  calls: ${calls} (about ${Math.ceil(calls * DRY_RUN_RETRY_FACTOR)} with drift retries)`,
      `  tokens per run without retries: ~${inTok} in, ~${outTok} out`,
      `  estimated cost: $${base.toFixed(3)} (about $${expected.toFixed(3)} with retries); cap --max-usd $${maxUsd}`,
      expected > maxUsd
        ? `  note: the cap would stop the run before all ${calls} are done`
        : `  the cap is sufficient`,
      `  ${PRICING_CAVEAT}`,
    ].join('\n'),
  );
}

// ----------------------------------------------------------------- budget

/** Spend cap. Reserves the estimate of each in-flight call. */
export class Budget {
  spent = 0;
  /** Set once a call was refused: nothing more is started. */
  exhausted = false;
  private reserved = 0;
  constructor(readonly maxUsd: number) {}

  tryReserve(estimate: number): boolean {
    if (this.spent + this.reserved + estimate > this.maxUsd) {
      this.exhausted = true;
      return false;
    }
    this.reserved += estimate;
    return true;
  }

  settle(estimate: number, actual: number): void {
    this.reserved -= estimate;
    this.spent += actual;
  }
}

export class BudgetStop extends Error {
  constructor() {
    super('Budget cap reached');
    this.name = 'BudgetStop';
  }
}

/** An error no retry can fix (bad key, missing model): abort the whole run. */
export class FatalLlmError extends Error {}

export class GenerationRun {
  readonly meter = new UsageMeter();
  constructor(
    readonly llm: SynthLlm,
    readonly budget: Budget,
  ) {}

  /** One model call under the budget. Throws BudgetStop when over the cap. */
  async call<S extends z.ZodType>(
    params: ParseStructuredParams<S>,
    estimateUsdForCall: number,
  ): Promise<ParseStructuredResult<z.infer<S>>> {
    if (!this.budget.tryReserve(estimateUsdForCall)) throw new BudgetStop();
    let result: ParseStructuredResult<z.infer<S>>;
    try {
      result = await this.llm.parseStructured(params);
    } catch (err) {
      this.budget.settle(estimateUsdForCall, 0);
      const status = (err as { status?: unknown }).status;
      if (status === 401 || status === 403 || status === 404) {
        throw new FatalLlmError(
          `OpenAI request rejected (HTTP ${String(status)}): check OPENAI_API_KEY and OPENAI_MODEL`,
        );
      }
      throw err;
    }
    this.meter.recordCall();
    this.meter.recordUsage(result.usage);
    this.budget.settle(
      estimateUsdForCall,
      result.usage
        ? costUsd(result.usage, DEFAULT_PRICING)
        : estimateUsdForCall,
    );
    return result;
  }

  get cost(): number {
    return this.budget.spent;
  }
}

// ------------------------------------------------------------- retry loop

export type AttemptResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; problems: string[] };

export interface Job<T> {
  id: string;
  /** One model call plus its checks. Throws BudgetStop when out of budget. */
  attempt(feedback: string[] | null): Promise<AttemptResult<T>>;
  /** Persists a passing result. */
  write(value: T): Promise<void>;
}

export interface JobOutcome {
  id: string;
  status: 'ok' | 'failed' | 'budget';
  attempts: number;
  problems: string[];
  warnings: string[];
}

/** Feedback for attempt `i` (0-based): retries 1 and 2 get the problems. */
export function feedbackFor(i: number, problems: string[]): string[] | null {
  return i >= 1 && i <= MAX_FEEDBACK_RETRIES ? problems : null;
}

export async function runJob<T>(job: Job<T>): Promise<JobOutcome> {
  const total = 1 + MAX_FEEDBACK_RETRIES + MAX_FRESH_ATTEMPTS;
  let problems: string[] = [];
  let attempts = 0;
  for (let i = 0; i < total; i++) {
    let result: AttemptResult<T>;
    try {
      attempts += 1;
      result = await job.attempt(feedbackFor(i, problems));
    } catch (err) {
      if (err instanceof BudgetStop) {
        return {
          id: job.id,
          status: 'budget',
          attempts: attempts - 1,
          problems,
          warnings: [],
        };
      }
      if (err instanceof FatalLlmError) throw err;
      result = {
        ok: false,
        problems: [
          `The model call failed: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
    if ('value' in result) {
      await job.write(result.value);
      return {
        id: job.id,
        status: 'ok',
        attempts,
        problems: [],
        warnings: result.warnings,
      };
    }
    problems = result.problems;
  }
  return { id: job.id, status: 'failed', attempts, problems, warnings: [] };
}

/**
 * One structured call and its checks. A refusal or empty answer becomes a
 * problem. `check` returns the value, or the problems that make it unusable.
 */
export async function structuredAttempt<S extends z.ZodType, T>(
  run: GenerationRun,
  call: {
    prompt: Prompt;
    schema: S;
    schemaName: string;
    estimateUsd: number;
  },
  check: (parsed: z.infer<S>) => AttemptResult<T>,
): Promise<AttemptResult<T>> {
  const result = await run.call(
    {
      system: call.prompt.system,
      user: call.prompt.user,
      schema: call.schema,
      schemaName: call.schemaName,
    },
    call.estimateUsd,
  );
  if (result.kind === 'refusal') {
    return { ok: false, problems: ['The model refused the request.'] };
  }
  if (result.kind === 'empty') {
    return {
      ok: false,
      problems: ['The model returned no structured answer.'],
    };
  }
  return check(result.parsed);
}

/** Runs `fn` over `items` with `concurrency` workers; stops pulling when `stop()`. */
export async function runPool<I, R>(
  items: I[],
  concurrency: number,
  fn: (item: I) => Promise<R>,
  stop: () => boolean,
): Promise<{ results: R[]; notStarted: I[]; fatal: Error | null }> {
  const results: R[] = [];
  let next = 0;
  let fatal: Error | null = null;
  const worker = async (): Promise<void> => {
    while (next < items.length && !stop() && fatal === null) {
      const item = items[next++];
      try {
        results.push(await fn(item));
      } catch (err) {
        fatal ??= err instanceof Error ? err : new Error(String(err));
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return { results, notStarted: items.slice(next), fatal };
}

// ------------------------------------------------------------------- log

export interface GenerationRunRecord {
  stage: string;
  timestamp: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls beyond the first, per item (drift retries and fresh attempts). */
  retries: number;
  generated: string[];
  failures: { id: string; problems: string[] }[];
  /** Ids not started because the budget cap was reached. */
  remaining: string[];
  stopped: 'budget' | null;
  warnings: Record<string, string[]>;
  maxUsd: number;
  pricing: typeof DEFAULT_PRICING;
  pricingCaveat: string;
}

const LOG_FILE = 'generation-log.json';

export async function appendGenerationLog(
  dir: string,
  record: GenerationRunRecord,
): Promise<void> {
  const path = join(dir, LOG_FILE);
  const log = (await exists(path))
    ? await readJson<{ runs: GenerationRunRecord[] }>(path)
    : { runs: [] };
  log.runs.push(record);
  await writeJson(path, log);
}

/**
 * Runs the jobs, writes the log record, prints the summary and throws when any
 * item failed (exit code 1) or the run hit a fatal error.
 */
export async function executeJobs<T>(
  stage: string,
  dir: string,
  run: GenerationRun,
  flags: CommonFlags,
  jobs: Job<T>[],
): Promise<JobOutcome[]> {
  const { results, notStarted, fatal } = await runPool(
    jobs,
    flags.concurrency,
    runJob,
    () => run.budget.exhausted,
  );

  const usage: LlmUsage | null = run.meter.usage;
  const outcomes = results;
  const budgetCut = outcomes.filter((o) => o.status === 'budget');
  const remaining = [
    ...budgetCut.map((o) => o.id),
    ...notStarted.map((j) => j.id),
  ];
  const failures = outcomes
    .filter((o) => o.status === 'failed')
    .map((o) => ({ id: o.id, problems: o.problems }));
  const warnings = Object.fromEntries(
    outcomes
      .filter((o) => o.warnings.length > 0)
      .map((o) => [o.id, o.warnings]),
  );
  const record: GenerationRunRecord = {
    stage,
    timestamp: new Date().toISOString(),
    model: usage?.model ?? run.llm.model,
    calls: run.meter.attempts,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: Number(run.cost.toFixed(6)),
    retries: outcomes.reduce((n, o) => n + Math.max(0, o.attempts - 1), 0),
    generated: outcomes.filter((o) => o.status === 'ok').map((o) => o.id),
    failures,
    remaining,
    stopped: remaining.length > 0 ? 'budget' : null,
    warnings,
    maxUsd: flags.maxUsd,
    pricing: DEFAULT_PRICING,
    pricingCaveat: PRICING_CAVEAT,
  };
  await appendGenerationLog(dir, record);

  console.log(
    `${stage}: ${record.generated.length} generated, ${failures.length} failed, ` +
      `${remaining.length} not started; ${record.calls} calls, ${record.retries} retries, ` +
      `${record.inputTokens} in / ${record.outputTokens} out tokens, ~$${record.costUsd.toFixed(4)} ` +
      `(cap $${flags.maxUsd}).`,
  );
  console.log(PRICING_CAVEAT);
  if (Object.keys(warnings).length > 0) {
    console.log(`Warnings (not failures): ${JSON.stringify(warnings)}`);
  }
  if (remaining.length > 0) {
    console.log(
      `Stopped at the --max-usd cap. Not generated: ${remaining.join(', ')}. Re-run to resume.`,
    );
  }
  if (fatal) throw fatal;
  if (failures.length > 0) {
    throw new Error(
      `${stage}: ${failures.length} failed after all attempts (nothing written for them):\n` +
        failures.map((f) => `  ${f.id}: ${f.problems.join(' | ')}`).join('\n'),
    );
  }
  return outcomes;
}
