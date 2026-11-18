/**
 * The scoring eval's runner: scores the sampled pairs in both modes with the
 * production scorer, in memory (nothing is written to the database), caching
 * every finished job so a run can be stopped and resumed, under a hard budget.
 */
import { Logger, type INestApplicationContext } from '@nestjs/common';
import OpenAI from 'openai';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../../db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../db/repositories/cv-documents.repository.js';
import type { GithubSnapshot } from '../../github/github-snapshot.js';
import {
  ApplicationScorer,
  LlmGroundingError,
  LlmScoreError,
  type ApplicationScoreResult,
  type ScoringCriterion,
} from '../../llm/application-scorer.js';
import { LlmClient } from '../../llm/llm-client.js';
import type { CriterionEvidence } from '../../llm/prompts/application-score-rag.prompt.js';
import { retrieveCriterionEvidence } from '../../rag/retrieve-criterion-evidence.js';
import { canSubmit } from '../seed/budget.js';
import { createRng } from '../synth/rng.js';
import { MARGIN } from '../seed/estimator.js';
import type { SeedMeter } from '../seed/metering.js';
import { costUsd, DEFAULT_PRICING, type Pricing } from '../parse-eval/cost.js';
import {
  appendScoreRecord,
  partitionJobs,
  prepareScoreCache,
  readScoreCache,
} from './cache.js';
import type { EvalDataset, EvalVacancy } from './preflight.js';
import type { SampledPair } from './sample.js';
import {
  jobKey,
  SCORING_MODES,
  type ScoreFailure,
  type ScoreJob,
  type ScoreJobRecord,
  type ScoringMode,
} from './score-record.js';

/** USD per score, measured on the seed with retries included (docs/eval/rag-scoring.md and the seed run). */
export const SCORE_UNIT_COST_USD = 0.0065;
/** Safety margin on the estimate (the seed's). */
export const SCORE_ESTIMATE_MARGIN = MARGIN;
/** What one job is expected to cost, for the dry-run and the budget guard. */
export const SCORE_JOB_ESTIMATE_USD =
  SCORE_UNIT_COST_USD * SCORE_ESTIMATE_MARGIN;
export const DEFAULT_MAX_USD = 6;
export const DEFAULT_CONCURRENCY = 4;
const PROGRESS_EVERY = 25;

export const estimateJobsUsd = (jobs: number): number =>
  jobs * SCORE_JOB_ESTIMATE_USD;

// ---------- planning ----------

export interface ScoringPlanOptions {
  /** The sampled pairs, in sample order. */
  pairs: readonly SampledPair[];
  /** The noise subset: scored a second time per mode. */
  noise?: readonly SampledPair[];
  /** Default both modes. */
  modes?: readonly ScoringMode[];
  /** Only the first n pairs, after the shuffle (applies to both runs and modes). */
  limit?: number;
  /**
   * Seeded shuffle of the pair order (both modes of a pair stay adjacent), so
   * a `--limit` smoke or a budget stop leaves a mixed subset rather than the
   * first vacancies in sample order. Omitted: sample order.
   */
  shuffleSeed?: number;
}

/**
 * Run 1 of every pair in every mode, then run 2 of the noise pairs: a budget
 * stop leaves whole run-1 coverage before any repeat.
 */
export function buildScoringJobs(options: ScoringPlanOptions): ScoreJob[] {
  const modes = options.modes ?? SCORING_MODES;
  const ordered =
    options.shuffleSeed === undefined
      ? [...options.pairs]
      : createRng(options.shuffleSeed).shuffle(options.pairs);
  const pairs =
    options.limit === undefined
      ? ordered
      : ordered.slice(0, Math.max(0, options.limit));
  const inScope = new Set(pairs);
  const jobs: ScoreJob[] = [];
  for (const pair of pairs) {
    for (const mode of modes) jobs.push({ pair, mode, run: 1 });
  }
  // Run 2 follows the same (shuffled) pair order.
  const noiseSet = new Set(options.noise ?? []);
  const noise =
    options.shuffleSeed === undefined
      ? (options.noise ?? [])
      : ordered.filter((pair) => noiseSet.has(pair));
  for (const pair of noise) {
    if (!inScope.has(pair)) continue;
    for (const mode of modes) jobs.push({ pair, mode, run: 2 });
  }
  return jobs;
}

export interface ScoringPlan {
  /** Jobs in scope (cache or not). */
  jobs: number;
  byMode: Record<ScoringMode, number>;
  byRun: { 1: number; 2: number };
  /** Reused from the cache at `cachePath`. */
  cachedOk: number;
  cachedFailed: number;
  /** Jobs a live run would make calls for. */
  toRun: number;
  unitUsd: number;
  margin: number;
  /** `toRun` jobs x $0.0065 x 1.3. */
  estimateUsd: number;
  /** The same for every job in scope. */
  totalEstimateUsd: number;
}

export interface PlanOptions extends ScoringPlanOptions {
  /** When given, finished jobs in this cache are not counted as to run. */
  cachePath?: string;
  retryFailed?: boolean;
}

/** Dry-run: counts and the cost estimate; makes no calls and writes nothing. */
export async function planScoringEval(
  options: PlanOptions,
): Promise<ScoringPlan> {
  const jobs = buildScoringJobs(options);
  const cache = options.cachePath
    ? await readScoreCache(options.cachePath)
    : { byKey: new Map<string, ScoreJobRecord>(), corruptLines: 0 };
  const { cached, toRun } = partitionJobs(
    jobs,
    cache,
    options.retryFailed ?? false,
  );
  const byMode = { full_text: 0, rag: 0 };
  const byRun = { 1: 0, 2: 0 };
  for (const job of jobs) {
    byMode[job.mode]++;
    byRun[job.run]++;
  }
  return {
    jobs: jobs.length,
    byMode,
    byRun,
    cachedOk: cached.filter((r) => r.status === 'ok').length,
    cachedFailed: cached.filter((r) => r.status === 'failed').length,
    toRun: toRun.length,
    unitUsd: SCORE_UNIT_COST_USD,
    margin: SCORE_ESTIMATE_MARGIN,
    estimateUsd: estimateJobsUsd(toRun.length),
    totalEstimateUsd: estimateJobsUsd(jobs.length),
  };
}

// ---------- running ----------

/** What the runner needs from the app: swapped for fakes in unit tests. */
export interface ScoringDeps {
  scorer: Pick<ApplicationScorer, 'score' | 'scoreRag'>;
  /** The candidate's parsed CV text and GitHub snapshot (full_text input). */
  loadFullTextInput(
    candidateId: string,
  ): Promise<{ cvText: string; github: GithubSnapshot | null }>;
  /** rag retrieval for the criteria (embeds them, then nearest chunks). */
  retrieve(
    candidateId: string,
    criteria: ScoringCriterion[],
  ): Promise<CriterionEvidence[]>;
  /** USD metered so far (chat and embeddings). */
  spentUsd(): number;
}

export interface RunScoringOptions extends ScoringPlanOptions {
  /** JSONL cache path (the CLI passes `docs/eval/baseline/<label>/scores.jsonl`). */
  cachePath: string;
  /** Default 4. */
  concurrency?: number;
  /** Hard cap on this run's spend in USD (default 6). */
  maxUsd?: number;
  retryFailed?: boolean;
  /** Chat pricing for `costUsd` of each record (default `DEFAULT_PRICING`). */
  pricing?: Pricing;
  /** Progress sink (default: the Nest logger). */
  log?: (message: string) => void;
  /** Clock for `at` (tests). */
  now?: () => Date;
}

export interface ScoringRunResult {
  /** Records of the jobs in scope, in job order: cached and new. */
  records: ScoreJobRecord[];
  counts: {
    /** Jobs in scope. */
    planned: number;
    /** Finished OK in this run. */
    done: number;
    /** Finished with a failure in this run. */
    failed: number;
    /** Reused from the cache (ok or failed). */
    skipped: number;
    /** Never started (budget stop). */
    notStarted: number;
  };
  /** `budget` when the cap stopped new jobs from starting. */
  stopped: 'budget' | null;
  /** Metered spend of this run in USD. */
  spentUsd: number;
  maxUsd: number;
  /** Cache lines that could not be read (a truncated last line). */
  corruptCacheLines: number;
}

/** Strips anything that looks like an API key from an error message. */
function safeMessage(error: Error): string {
  return error.message.replace(/sk-[A-Za-z0-9_*.-]{4,}/g, 'sk-***');
}

/**
 * grounding = `LlmGroundingError`, parse = any other `LlmScoreError`, api =
 * an OpenAI/network error. Anything else is a bug or a data problem: null, and
 * the runner aborts instead of recording it.
 */
export function classifyFailure(error: unknown): ScoreFailure | null {
  if (error instanceof LlmGroundingError) {
    return {
      kind: 'grounding',
      problems: [...error.problems],
      message: error.message,
    };
  }
  if (error instanceof LlmScoreError) {
    return { kind: 'parse', message: error.message };
  }
  if (error instanceof OpenAI.APIError) {
    return {
      kind: 'api',
      message: `${error.name}${error.status ? ` (${error.status})` : ''}: ${safeMessage(error)}`,
    };
  }
  return null;
}

interface ResolvedJob {
  job: ScoreJob;
  candidateId: string;
  vacancy: EvalVacancy;
}

function resolveJob(dataset: EvalDataset, job: ScoreJob): ResolvedJob {
  const candidateId = dataset.candidateIdByPersonaId.get(job.pair.personaId);
  const vacancy = dataset.vacancies.find(
    (v) => v.spec.id === job.pair.vacancyId,
  );
  if (!candidateId) {
    throw new Error(`No candidate for persona ${job.pair.personaId}`);
  }
  if (!vacancy) throw new Error(`No vacancy ${job.pair.vacancyId}`);
  return { job, candidateId, vacancy };
}

function toRecord(
  job: ScoreJob,
  result: ApplicationScoreResult,
  pricing: Pricing,
  at: Date,
): ScoreJobRecord {
  return {
    key: jobKey(job),
    vacancyId: job.pair.vacancyId,
    personaId: job.pair.personaId,
    mode: job.mode,
    run: job.run,
    at: at.toISOString(),
    status: 'ok',
    overall: result.overall,
    attempts: result.attempts,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: costUsd(
      {
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.inputTokens + result.usage.outputTokens,
      },
      pricing,
    ),
    criteria: result.criteria.map((c) => ({
      id: c.criterionId,
      text: c.criterion,
      importance: c.importance,
      score: c.score,
      reasoning: c.reasoning,
      quotes: c.quotes.map((q) => ({ source: q.source, text: q.text })),
    })),
  };
}

async function scoreJob(
  deps: ScoringDeps,
  { job, candidateId, vacancy }: ResolvedJob,
): Promise<ApplicationScoreResult> {
  const criteria: ScoringCriterion[] = vacancy.criteria.map((c) => ({
    id: c.id,
    text: c.text,
    importance: c.importance,
  }));
  if (job.mode === 'rag') {
    const evidence = await deps.retrieve(candidateId, criteria);
    return deps.scorer.scoreRag({ criteria, evidence });
  }
  const { cvText, github } = await deps.loadFullTextInput(candidateId);
  return deps.scorer.score({ criteria, cvText, github });
}

/**
 * The runner on injected dependencies. Never writes to the database. Start
 * rule: a job starts only if this run's spend, plus the estimate of the jobs
 * in flight, plus this job's estimate, stays within `maxUsd`
 * (`seed/budget.ts#canSubmit`); the first refusal stops all starting, the
 * jobs in flight finish and are recorded, and `stopped` is `'budget'`.
 */
export async function runScoringJobs(
  deps: ScoringDeps,
  dataset: EvalDataset,
  options: RunScoringOptions,
): Promise<ScoringRunResult> {
  const maxUsd = options.maxUsd ?? DEFAULT_MAX_USD;
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
    throw new Error('maxUsd must be a positive number');
  }
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const pricing = options.pricing ?? DEFAULT_PRICING;
  const log = options.log ?? ((m: string) => new Logger('ScoringEval').log(m));
  const now = options.now ?? (() => new Date());

  const jobs = buildScoringJobs(options);
  // Fail on a bad reference before any call is made.
  const resolved = new Map(
    jobs.map((j) => [jobKey(j), resolveJob(dataset, j)]),
  );

  await prepareScoreCache(options.cachePath);
  const cache = await readScoreCache(options.cachePath);
  const { cached, toRun } = partitionJobs(
    jobs,
    cache,
    options.retryFailed ?? false,
  );
  log(
    `Scoring eval: ${jobs.length} jobs, ${cached.length} cached, ${toRun.length} to run (concurrency ${concurrency}, cap $${maxUsd.toFixed(2)})`,
  );

  const baseline = deps.spentUsd();
  const fresh = new Map<string, ScoreJobRecord>();
  let done = 0;
  let failed = 0;
  let finished = 0;
  let inFlight = 0;
  let next = 0;
  let stopped: 'budget' | null = null;
  let fatal: unknown = null;

  const runOne = async (job: ScoreJob): Promise<void> => {
    const ref = resolved.get(jobKey(job))!;
    let record: ScoreJobRecord;
    try {
      const result = await scoreJob(deps, ref);
      record = toRecord(job, result, pricing, now());
      done++;
    } catch (error) {
      const failure = classifyFailure(error);
      if (!failure) throw error;
      record = {
        key: jobKey(job),
        vacancyId: job.pair.vacancyId,
        personaId: job.pair.personaId,
        mode: job.mode,
        run: job.run,
        at: now().toISOString(),
        status: 'failed',
        failure,
      };
      failed++;
    }
    await appendScoreRecord(options.cachePath, record);
    fresh.set(record.key, record);
    finished++;
    if (finished % PROGRESS_EVERY === 0) {
      log(
        `Scoring eval: ${finished}/${toRun.length} finished (${failed} failed), spent $${(deps.spentUsd() - baseline).toFixed(4)}`,
      );
    }
  };

  const worker = async (): Promise<void> => {
    while (!stopped && fatal === null && next < toRun.length) {
      const spent = deps.spentUsd() - baseline;
      if (
        !canSubmit(
          spent,
          inFlight * SCORE_JOB_ESTIMATE_USD,
          SCORE_JOB_ESTIMATE_USD,
          maxUsd,
        )
      ) {
        stopped = 'budget';
        return;
      }
      const job = toRun[next++];
      inFlight++;
      try {
        await runOne(job);
      } catch (error) {
        fatal ??= error;
      } finally {
        inFlight--;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, toRun.length) }, worker),
  );
  if (fatal !== null) throw fatal;

  const cachedByKey = new Map(cached.map((r) => [r.key, r]));
  const records = jobs
    .map((j) => fresh.get(jobKey(j)) ?? cachedByKey.get(jobKey(j)))
    .filter((r): r is ScoreJobRecord => r !== undefined);
  const spentUsd = deps.spentUsd() - baseline;
  log(
    `Scoring eval: ${done} done, ${failed} failed, ${cached.length} skipped${stopped ? `, stopped on budget with ${toRun.length - next} not started` : ''}; spent $${spentUsd.toFixed(4)}`,
  );
  return {
    records,
    counts: {
      planned: jobs.length,
      done,
      failed,
      skipped: cached.length,
      notStarted: toRun.length - next,
    },
    stopped,
    spentUsd,
    maxUsd,
    corruptCacheLines: cache.corruptLines,
  };
}

/** `ScoringDeps` of the real eval context. */
export function scoringDepsFromApp(
  app: INestApplicationContext,
  meter: SeedMeter,
): ScoringDeps {
  const candidates = app.get<CandidatesRepository>(CANDIDATES_REPOSITORY);
  const cvDocuments = app.get<CvDocumentsRepository>(CV_DOCUMENTS_REPOSITORY);
  const chunks = app.get<CandidateChunksRepository>(
    CANDIDATE_CHUNKS_REPOSITORY,
  );
  const llm = app.get(LlmClient);
  return {
    scorer: app.get(ApplicationScorer),
    // Mirrors `ScoreApplicationWorker.scoreFullText`.
    async loadFullTextInput(candidateId) {
      const embed = await candidates.findEmbedState(candidateId);
      const cvDocumentId = embed?.parsedCvDocumentId;
      if (!cvDocumentId) throw new Error('Candidate has no parsed CV');
      const cvText = await cvDocuments.findTextById(cvDocumentId);
      if (cvText === null) throw new Error('CV document not found');
      const github = await candidates.findGithubSnapshot(candidateId);
      return { cvText, github };
    },
    // Mirrors `ScoreApplicationWorker.scoreFromChunks`.
    retrieve: (candidateId, criteria) =>
      retrieveCriterionEvidence(llm, chunks, candidateId, criteria),
    spentUsd: () => meter.spentUsd,
  };
}

export interface RunScoringEvalOptions extends RunScoringOptions {
  /** The meter of the eval context's `MeteredLlmClient`. */
  meter: SeedMeter;
}

/** Live run on the eval context. Writes only the cache file. */
export function runScoringEval(
  app: INestApplicationContext,
  dataset: EvalDataset,
  options: RunScoringEvalOptions,
): Promise<ScoringRunResult> {
  return runScoringJobs(
    scoringDepsFromApp(app, options.meter),
    dataset,
    options,
  );
}
