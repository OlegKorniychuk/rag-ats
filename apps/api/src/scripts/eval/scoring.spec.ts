import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import OpenAI from 'openai';
import {
  LlmGroundingError,
  LlmScoreError,
  type ApplicationScoreResult,
  type ScoringCriterion,
} from '../../llm/application-scorer.js';
import { appendScoreRecord, readScoreCache } from './cache.js';
import type { EvalDataset } from './preflight.js';
import type { SampledPair } from './sample.js';
import {
  buildScoringJobs,
  classifyFailure,
  estimateJobsUsd,
  planScoringEval,
  runScoringJobs,
  SCORE_JOB_ESTIMATE_USD,
  SCORE_UNIT_COST_USD,
  type ScoringDeps,
} from './scoring.js';
import { jobKey, type ScoreOkRecord } from './score-record.js';

const pair = (
  personaId: string,
  band: SampledPair['band'] = 'partial',
): SampledPair => ({
  vacancyId: 'v1',
  personaId,
  score: 50,
  band,
  weight: 1,
  spotCheck: null,
});

const PAIRS = ['a', 'b', 'c', 'd', 'e'].map((id) => pair(id));

const dataset = {
  taxonomy: { description: '', tags: [] },
  personas: [],
  vacancies: [
    {
      spec: { id: 'v1' },
      id: 'db-v1',
      criteria: [
        { id: 'c1', text: 'TypeScript', importance: 'must' },
        { id: 'c2', text: 'Docker', importance: 'nice' },
      ],
      criteriaHash: 'h',
    },
  ],
  candidateIdByPersonaId: new Map(
    PAIRS.map((p) => [p.personaId, `cand-${p.personaId}`]),
  ),
} as unknown as EvalDataset;

function result(
  criteria: ScoringCriterion[],
  overall = 70,
  attempts: 1 | 2 = 1,
): ApplicationScoreResult {
  return {
    criteria: criteria.map((c) => ({
      criterionId: c.id,
      criterion: c.text,
      importance: c.importance,
      score: overall,
      reasoning: 'r',
      quotes: [{ source: 'cv', text: 'a quote' }],
      retrieved: null,
    })),
    rationale: 'ok',
    overall,
    usage: { inputTokens: 1000, outputTokens: 200, model: 'm' },
    attempts,
  };
}

interface FakeOptions {
  perCallUsd?: number;
  fail?: (candidateId: string, mode: 'full_text' | 'rag') => unknown;
}

function fakeDeps(options: FakeOptions = {}) {
  const calls: Array<{ mode: 'full_text' | 'rag'; candidateId: string }> = [];
  let spent = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const current = { candidateId: '' };
  const run = async (
    mode: 'full_text' | 'rag',
    candidateId: string,
    criteria: ScoringCriterion[],
  ): Promise<ApplicationScoreResult> => {
    calls.push({ mode, candidateId });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    spent += options.perCallUsd ?? 0.001;
    const failure = options.fail?.(candidateId, mode);
    if (failure) throw failure;
    return result(criteria);
  };
  const deps: ScoringDeps = {
    scorer: {
      score: async ({ criteria, cvText }) =>
        run('full_text', cvText.replace('cv of ', ''), criteria),
      scoreRag: async ({ criteria, evidence }) =>
        run(
          'rag',
          evidence[0].chunks[0].text.replace('chunk of ', ''),
          criteria,
        ),
    },
    loadFullTextInput: async (candidateId) => {
      current.candidateId = candidateId;
      return { cvText: `cv of ${candidateId}`, github: null };
    },
    retrieve: async (candidateId, criteria) =>
      criteria.map((c) => ({
        criterionId: c.id,
        chunks: [
          { source: 'cv', text: `chunk of ${candidateId}`, similarity: 0.9 },
        ],
      })),
    spentUsd: () => spent,
  };
  return { deps, calls, maxInFlight: () => maxInFlight };
}

describe('scoring runner', () => {
  let dir: string;
  let cachePath: string;
  const log = () => undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scoring-'));
    cachePath = join(dir, 'scores.jsonl');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  describe('buildScoringJobs', () => {
    it('is run 1 of every pair in every mode, then run 2 of the noise pairs', () => {
      const jobs = buildScoringJobs({
        pairs: PAIRS.slice(0, 3),
        noise: [PAIRS[1]],
      });
      expect(jobs.map((j) => `${j.pair.personaId}:${j.mode}:${j.run}`)).toEqual(
        [
          'a:full_text:1',
          'a:rag:1',
          'b:full_text:1',
          'b:rag:1',
          'c:full_text:1',
          'c:rag:1',
          'b:full_text:2',
          'b:rag:2',
        ],
      );
    });

    it('limits to the first n sampled pairs for both runs and modes', () => {
      const jobs = buildScoringJobs({
        pairs: PAIRS,
        noise: [PAIRS[0], PAIRS[4]],
        limit: 2,
      });
      expect(jobs).toHaveLength(2 * 2 + 1 * 2);
      expect(jobs.some((j) => j.pair.personaId === 'e')).toBe(false);
    });

    it('shuffles the pair order by seed before the limit, keeping both modes of a pair adjacent', () => {
      const key = (j: {
        pair: { personaId: string };
        mode: string;
        run: number;
      }) => `${j.pair.personaId}:${j.mode}:${j.run}`;
      const a = buildScoringJobs({
        pairs: PAIRS,
        noise: [PAIRS[0], PAIRS[4]],
        shuffleSeed: 7,
      });
      const b = buildScoringJobs({
        pairs: PAIRS,
        noise: [PAIRS[0], PAIRS[4]],
        shuffleSeed: 7,
      });
      expect(a.map(key)).toEqual(b.map(key));
      const run1 = a.filter((j) => j.run === 1).map((j) => j.pair.personaId);
      expect(new Set(run1)).toEqual(new Set(PAIRS.map((p) => p.personaId)));
      for (let i = 0; i < run1.length; i += 2)
        expect(run1[i]).toBe(run1[i + 1]);
      const order = run1.filter((_, i) => i % 2 === 0);
      expect(a.filter((j) => j.run === 2).map((j) => j.pair.personaId)).toEqual(
        order
          .filter(
            (id) => id === PAIRS[0].personaId || id === PAIRS[4].personaId,
          )
          .flatMap((id) => [id, id]),
      );
      const limited = buildScoringJobs({
        pairs: PAIRS,
        limit: 2,
        shuffleSeed: 7,
      });
      expect(limited.map((j) => j.pair.personaId)).toEqual([
        order[0],
        order[0],
        order[1],
        order[1],
      ]);
      const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        buildScoringJobs({ pairs: PAIRS, shuffleSeed: seed }).map(key).join(),
      );
      expect(new Set(seeds).size).toBeGreaterThan(1);
    });

    it('honours the modes', () => {
      const jobs = buildScoringJobs({
        pairs: PAIRS.slice(0, 2),
        noise: [PAIRS[0]],
        modes: ['rag'],
      });
      expect(jobs.map((j) => j.mode)).toEqual(['rag', 'rag', 'rag']);
    });
  });

  describe('planScoringEval (dry-run)', () => {
    it('counts jobs and estimates jobs x $0.0065 x 1.3 without a cache', async () => {
      const plan = await planScoringEval({
        pairs: PAIRS,
        noise: [PAIRS[0], PAIRS[1]],
      });
      expect(plan.jobs).toBe(14);
      expect(plan.byMode).toEqual({ full_text: 7, rag: 7 });
      expect(plan.byRun).toEqual({ 1: 10, 2: 4 });
      expect(plan.toRun).toBe(14);
      expect(plan.estimateUsd).toBeCloseTo(14 * 0.0065 * 1.3, 10);
      expect(SCORE_UNIT_COST_USD).toBe(0.0065);
      expect(estimateJobsUsd(1)).toBeCloseTo(SCORE_JOB_ESTIMATE_USD, 12);
    });

    it('leaves finished jobs out of the estimate', async () => {
      const jobs = buildScoringJobs({ pairs: PAIRS.slice(0, 2) });
      await appendScoreRecord(cachePath, {
        key: jobKey(jobs[0]),
        vacancyId: 'v1',
        personaId: 'a',
        mode: 'full_text',
        run: 1,
        at: '',
        status: 'failed',
        failure: { kind: 'api', message: 'x' },
      });
      const plan = await planScoringEval({
        pairs: PAIRS.slice(0, 2),
        cachePath,
      });
      expect(plan.cachedFailed).toBe(1);
      expect(plan.toRun).toBe(3);
      const retry = await planScoringEval({
        pairs: PAIRS.slice(0, 2),
        cachePath,
        retryFailed: true,
      });
      expect(retry.toRun).toBe(4);
      expect(retry.totalEstimateUsd).toBeCloseTo(4 * 0.0065 * 1.3, 10);
    });
  });

  describe('runScoringJobs', () => {
    it('scores both modes, caches every record and runs with bounded concurrency', async () => {
      const { deps, calls, maxInFlight } = fakeDeps();
      const out = await runScoringJobs(deps, dataset, {
        pairs: PAIRS,
        noise: [PAIRS[0]],
        cachePath,
        concurrency: 3,
        maxUsd: 100,
        log,
      });
      expect(out.stopped).toBeNull();
      expect(out.counts).toEqual({
        planned: 12,
        done: 12,
        failed: 0,
        skipped: 0,
        notStarted: 0,
      });
      expect(calls).toHaveLength(12);
      expect(maxInFlight()).toBeGreaterThan(1);
      expect(maxInFlight()).toBeLessThanOrEqual(3);

      const first = out.records[0] as ScoreOkRecord;
      expect(first).toMatchObject({
        key: 'v1|a|full_text|1',
        mode: 'full_text',
        run: 1,
        status: 'ok',
        overall: 70,
        attempts: 1,
        inputTokens: 1000,
        outputTokens: 200,
      });
      // 1000 in at 0.75 + 200 out at 4.5 per million
      expect(first.costUsd).toBeCloseTo(0.00165, 8);
      expect(first.criteria[0]).toMatchObject({
        id: 'c1',
        text: 'TypeScript',
        importance: 'must',
        score: 70,
        quotes: [{ source: 'cv', text: 'a quote' }],
      });
      expect(out.records.map((r) => r.key)).toEqual(
        buildScoringJobs({ pairs: PAIRS, noise: [PAIRS[0]] }).map(jobKey),
      );
      expect((await readScoreCache(cachePath)).byKey.size).toBe(12);
      // rag jobs go through retrieval, full_text through the CV
      expect(calls.filter((c) => c.mode === 'rag')).toHaveLength(6);
      expect(out.spentUsd).toBeCloseTo(12 * 0.001, 10);
    });

    it('a second run skips everything and makes no calls', async () => {
      const options = {
        pairs: PAIRS.slice(0, 2),
        cachePath,
        maxUsd: 100,
        log,
      };
      await runScoringJobs(fakeDeps().deps, dataset, options);
      const second = fakeDeps();
      const out = await runScoringJobs(second.deps, dataset, options);
      expect(second.calls).toHaveLength(0);
      expect(out.counts).toMatchObject({ done: 0, skipped: 4, notStarted: 0 });
      expect(out.records).toHaveLength(4);
    });

    it('resumes: runs only what the cache lacks', async () => {
      const jobs = buildScoringJobs({ pairs: PAIRS.slice(0, 2) });
      const seed = fakeDeps();
      await runScoringJobs(seed.deps, dataset, {
        pairs: PAIRS.slice(0, 1),
        cachePath,
        maxUsd: 100,
        log,
      });
      const next = fakeDeps();
      const out = await runScoringJobs(next.deps, dataset, {
        pairs: PAIRS.slice(0, 2),
        cachePath,
        maxUsd: 100,
        log,
      });
      expect(next.calls.map((c) => c.candidateId)).toEqual([
        'cand-b',
        'cand-b',
      ]);
      expect(out.counts).toMatchObject({ done: 2, skipped: 2 });
      expect(out.records.map((r) => r.key)).toEqual(jobs.map(jobKey));
    });

    it('records failures, skips them next time, retries them with retryFailed (newest line wins)', async () => {
      const options = { pairs: PAIRS.slice(0, 2), cachePath, maxUsd: 100, log };
      const first = await runScoringJobs(
        fakeDeps({
          fail: (c, mode) =>
            c === 'cand-a' && mode === 'rag'
              ? new LlmGroundingError(['Criterion c1 is missing'])
              : null,
        }).deps,
        dataset,
        options,
      );
      expect(first.counts).toMatchObject({ done: 3, failed: 1 });
      expect(first.records.filter((r) => r.status === 'failed')).toHaveLength(
        1,
      );

      const skip = fakeDeps();
      const skipped = await runScoringJobs(skip.deps, dataset, options);
      expect(skip.calls).toHaveLength(0);
      expect(skipped.counts).toMatchObject({ skipped: 4, failed: 0 });
      expect(skipped.records.filter((r) => r.status === 'failed')).toHaveLength(
        1,
      );

      const retry = fakeDeps();
      const retried = await runScoringJobs(retry.deps, dataset, {
        ...options,
        retryFailed: true,
      });
      expect(retry.calls).toEqual([{ mode: 'rag', candidateId: 'cand-a' }]);
      expect(retried.counts).toMatchObject({ done: 1, skipped: 3 });
      expect(retried.records.every((r) => r.status === 'ok')).toBe(true);

      // the file keeps both lines; a later load sees the success
      const lines = (await readFile(cachePath, 'utf8')).trimEnd().split('\n');
      expect(lines).toHaveLength(5);
      const final = await runScoringJobs(fakeDeps().deps, dataset, options);
      expect(final.records.every((r) => r.status === 'ok')).toBe(true);
    });

    it('stops starting jobs at the budget, drains the ones in flight, and reports it', async () => {
      // Each call costs $0.005; the per-job estimate is $0.00845.
      const fake = fakeDeps({ perCallUsd: 0.005 });
      const out = await runScoringJobs(fake.deps, dataset, {
        pairs: PAIRS,
        cachePath,
        concurrency: 2,
        maxUsd: 0.03,
        log,
      });
      expect(out.stopped).toBe('budget');
      expect(out.counts.notStarted).toBeGreaterThan(0);
      expect(out.counts.done + out.counts.notStarted).toBe(10);
      // every started job was finished and cached
      expect(out.counts.done).toBe(fake.calls.length);
      expect((await readScoreCache(cachePath)).byKey.size).toBe(
        out.counts.done,
      );
      // spend + the in-flight and next estimates never exceeded the cap when a job started
      expect(out.spentUsd).toBeLessThanOrEqual(0.03);
      expect(out.maxUsd).toBe(0.03);
    });

    it('does not start anything when one job would not fit', async () => {
      const fake = fakeDeps();
      const out = await runScoringJobs(fake.deps, dataset, {
        pairs: PAIRS,
        cachePath,
        maxUsd: 0.001,
        log,
      });
      expect(out.stopped).toBe('budget');
      expect(fake.calls).toHaveLength(0);
      expect(out.counts).toMatchObject({ done: 0, notStarted: 10 });
    });

    it("counts only this run's spend against the cap", async () => {
      const fake = fakeDeps({ perCallUsd: 0.001 });
      // the meter already holds $5 from earlier work
      const deps: ScoringDeps = {
        ...fake.deps,
        spentUsd: () => 5 + fake.deps.spentUsd(),
      };
      const out = await runScoringJobs(deps, dataset, {
        pairs: PAIRS.slice(0, 1),
        cachePath,
        maxUsd: 1,
        log,
      });
      expect(out.stopped).toBeNull();
      expect(out.spentUsd).toBeCloseTo(0.002, 10);
    });

    it('rejects a non-positive cap and unknown references before any call', async () => {
      const fake = fakeDeps();
      await expect(
        runScoringJobs(fake.deps, dataset, {
          pairs: PAIRS,
          cachePath,
          maxUsd: 0,
          log,
        }),
      ).rejects.toThrow('maxUsd');
      await expect(
        runScoringJobs(fake.deps, dataset, {
          pairs: [pair('ghost')],
          cachePath,
          log,
        }),
      ).rejects.toThrow('No candidate for persona ghost');
      expect(fake.calls).toHaveLength(0);
    });

    it('aborts on an unexpected error after recording what finished', async () => {
      const fake = fakeDeps({
        fail: (c) => (c === 'cand-b' ? new TypeError('bug') : null),
      });
      await expect(
        runScoringJobs(fake.deps, dataset, {
          pairs: PAIRS,
          cachePath,
          concurrency: 1,
          maxUsd: 100,
          log,
        }),
      ).rejects.toThrow('bug');
      // a's two jobs are cached; b's are not
      expect((await readScoreCache(cachePath)).byKey.size).toBe(2);
    });

    it('logs progress every 25 jobs', async () => {
      const messages: string[] = [];
      const many = Array.from({ length: 13 }, (_, i) => pair(`p${i}`));
      const ds = {
        ...dataset,
        candidateIdByPersonaId: new Map(
          many.map((p) => [p.personaId, p.personaId]),
        ),
      } as unknown as EvalDataset;
      await runScoringJobs(fakeDeps().deps, ds, {
        pairs: many,
        cachePath,
        maxUsd: 100,
        log: (m) => messages.push(m),
      });
      // 26 jobs: start line, one progress line (25), final line
      expect(messages).toHaveLength(3);
      expect(messages[1]).toContain('25/26');
    });

    it('tolerates a truncated last cache line', async () => {
      await writeFile(cachePath, '{"key":"v1|a|full_text|1","status":"o');
      const fake = fakeDeps();
      const out = await runScoringJobs(fake.deps, dataset, {
        pairs: PAIRS.slice(0, 1),
        cachePath,
        maxUsd: 100,
        log,
      });
      expect(out.corruptCacheLines).toBe(1);
      expect(out.counts.done).toBe(2);
      expect((await readScoreCache(cachePath)).byKey.size).toBe(2);
    });
  });
});

describe('classifyFailure', () => {
  it('grounding: LlmGroundingError with its problems', () => {
    expect(
      classifyFailure(new LlmGroundingError(['Criterion c1 is missing'])),
    ).toEqual({
      kind: 'grounding',
      problems: ['Criterion c1 is missing'],
      message: 'Could not ground the score in the CV',
    });
  });

  it('parse: any other LlmScoreError', () => {
    expect(classifyFailure(new LlmScoreError())).toEqual({
      kind: 'parse',
      message: 'The model could not score the application',
    });
  });

  it('api: an OpenAI error, with no key in the message', () => {
    const error = OpenAI.APIError.generate(
      401,
      { message: 'Incorrect API key provided: sk-abcdef1234567890' },
      'Incorrect API key provided: sk-abcdef1234567890',
      new Headers(),
    );
    const failure = classifyFailure(error)!;
    expect(failure.kind).toBe('api');
    expect(failure.message).toContain('401');
    expect(failure.message).not.toContain('abcdef1234567890');
  });

  it('api: a connection error', () => {
    expect(
      classifyFailure(new OpenAI.APIConnectionError({ message: 'down' }))?.kind,
    ).toBe('api');
  });

  it('anything else is not classified', () => {
    expect(classifyFailure(new Error('CV document not found'))).toBeNull();
    expect(classifyFailure('x')).toBeNull();
  });
});
