import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_BOSS } from '../../src/jobs/jobs.tokens.js';
import { APPLICATION_SCORE_SCHEMA_NAME } from '../../src/llm/application-score.schema.js';
import { createEvalContext } from '../../src/scripts/eval/app.js';
import type { SyntheticSet } from '../../src/scripts/eval/data.js';
import { loadEvalDataset } from '../../src/scripts/eval/dataset.js';
import type { EvalDataset } from '../../src/scripts/eval/preflight.js';
import type { SampledPair } from '../../src/scripts/eval/sample.js';
import type { ScoreOkRecord } from '../../src/scripts/eval/score-record.js';
import {
  planScoringEval,
  runScoringEval,
} from '../../src/scripts/eval/scoring.js';
import { DEFAULT_PRICING } from '../../src/scripts/parse-eval/cost.js';
import { SeedMeter } from '../../src/scripts/seed/metering.js';
import { runSeed } from '../../src/scripts/seed/run.js';
import { isDrained } from '../../src/scripts/seed/snapshot.js';
import { onUnhandledFrame, server } from '../msw/server.js';
import { textPdf } from '../pdf.util.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';
import {
  GITHUB_FIXTURE,
  GITHUB_USERNAME,
  persona,
  testEnv,
  vacancy,
} from './seed-fixtures.util.js';

const VACANCIES = [vacancy('alpha'), vacancy('beta')];
const MINI_SET = [
  persona('e1', ['alpha', 'beta'], GITHUB_USERNAME),
  persona('e2', ['alpha', 'beta']),
  persona('e3', ['beta']),
];

const syntheticSet = (): SyntheticSet => ({
  personas: MINI_SET,
  vacancies: VACANCIES,
  groundTruth: { pairs: [] },
  queries: [],
  taxonomy: { description: '', tags: [] },
  spotCheckLabels: [],
});

const sampled = (
  vacancyId: string,
  personaId: string,
  band: SampledPair['band'],
): SampledPair => ({
  vacancyId,
  personaId,
  score: 50,
  band,
  weight: 1,
  spotCheck: null,
});

const PAIRS = [
  sampled('alpha', 'e1', 'strong'),
  sampled('alpha', 'e2', 'partial'),
  sampled('beta', 'e1', 'partial'),
  sampled('beta', 'e2', 'weak'),
  sampled('beta', 'e3', 'weak'),
];
const NOISE = [PAIRS[0], PAIRS[3]];
// 5 pairs x 2 modes + 2 noise pairs x 2 modes
const JOBS = 14;

describe('scoring eval (Testcontainers + MSW)', () => {
  let testDb: TestDatabase;
  let dir: string;
  let pool: Pool;
  let dataset: EvalDataset;
  const contexts: INestApplicationContext[] = [];

  async function tableFingerprints(): Promise<Record<string, string>> {
    const { rows: tables } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    const out: Record<string, string> = {};
    for (const { table_name } of tables) {
      const { rows } = await pool.query<{ n: string; h: string | null }>(
        `SELECT count(*) AS n,
                md5(string_agg(t::text, ',' ORDER BY t::text)) AS h
           FROM "${table_name}" t`,
      );
      out[table_name] = `${rows[0].n}:${rows[0].h}`;
    }
    return out;
  }

  async function bootEval(meter: SeedMeter): Promise<INestApplicationContext> {
    const { DRIZZLE } = await import('../../src/db/db.tokens.js');
    const app = await createEvalContext({
      env: testEnv(join(dir, 'github')),
      meter,
      customize: (builder) =>
        builder.overrideProvider(DRIZZLE).useValue(testDb.db),
    });
    contexts.push(app);
    return app;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-scoring-it-'));
    await mkdir(join(dir, 'pdf'));
    await mkdir(join(dir, 'github'));
    for (const p of MINI_SET) {
      await writeFile(
        join(dir, 'pdf', `${p.id}.pdf`),
        textPdf([`CV of ${p.name}`, `Unique marker ${p.id}`, 'TypeScript']),
      );
    }
    await writeFile(
      join(dir, 'github', `${GITHUB_USERNAME}.json`),
      JSON.stringify(GITHUB_FIXTURE),
    );
    testDb = await createTestDatabase();
    pool = testDb.pool;
    server.listen({ onUnhandledFrame });

    // Seed the mini set with the real seed, then drop the queue schema it
    // created so the eval context starts from a database with no pg-boss.
    process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused';
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.NODE_ENV ??= 'test';
    process.env.OPENAI_API_KEY ??= 'test-key';
    const { createSeedContext } = await import('../../src/scripts/seed/app.js');
    const { DRIZZLE } = await import('../../src/db/db.tokens.js');
    const seedMeter = new SeedMeter(DEFAULT_PRICING);
    const seedApp = await createSeedContext({
      env: testEnv(join(dir, 'github')),
      meter: seedMeter,
      customize: (builder) =>
        builder.overrideProvider(DRIZZLE).useValue(testDb.db),
    });
    const result = await runSeed(seedApp, {
      dir,
      personas: MINI_SET,
      vacancies: VACANCIES,
      recruiterPassword: 'integration-test-password',
      maxUsd: 100,
      timeoutMs: 60_000,
      concurrency: 2,
      pollMs: 100,
      meter: seedMeter,
    });
    expect(result.stopped).toBeNull();
    expect(isDrained(result.snapshot)).toBe(true);
    await seedApp.close();
    await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE');

    const app = await bootEval(new SeedMeter(DEFAULT_PRICING));
    dataset = await loadEvalDataset(app, syntheticSet());
    await app.close();
    contexts.pop();
  }, 180_000);

  afterEach(async () => {
    for (const app of contexts.splice(0)) await app.close();
  });

  afterAll(async () => {
    server.close();
    await teardownTestDatabase(testDb);
    await rm(dir, { recursive: true, force: true });
  });

  it('scores both modes into the cache, changes no rows, and a re-run makes no calls', async () => {
    const cachePath = join(dir, 'run', 'scores.jsonl');
    const before = await tableFingerprints();
    const options = {
      pairs: PAIRS,
      noise: NOISE,
      cachePath,
      concurrency: 3,
      maxUsd: 5,
      log: () => undefined,
    };

    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    expect(() => app.get(PG_BOSS)).toThrow();
    const plan = await planScoringEval(options);
    expect(plan.toRun).toBe(JOBS);
    expect(meter.chatCalls).toBe(0);

    const out = await runScoringEval(app, dataset, { ...options, meter });

    expect(out.stopped).toBeNull();
    expect(out.counts).toEqual({
      planned: JOBS,
      done: JOBS,
      failed: 0,
      skipped: 0,
      notStarted: 0,
    });
    expect(out.records.every((r) => r.status === 'ok')).toBe(true);
    // one model call per score (the mock quotes real text, so no retry),
    // and one embeddings call per rag score
    expect(meter.calls(APPLICATION_SCORE_SCHEMA_NAME)).toBe(JOBS);
    expect(meter.embeddingCallCount).toBe(JOBS / 2);
    expect(out.spentUsd).toBeCloseTo(meter.spentUsd, 10);

    const ok = out.records as ScoreOkRecord[];
    expect(ok.filter((r) => r.mode === 'rag')).toHaveLength(JOBS / 2);
    expect(ok.filter((r) => r.run === 2)).toHaveLength(4);
    for (const record of ok) {
      expect(record.attempts).toBe(1);
      expect(record.inputTokens).toBe(1200);
      expect(record.outputTokens).toBe(300);
      expect(record.costUsd).toBeCloseTo(0.00225, 8);
      const stored = dataset.vacancies.find(
        (v) => v.spec.id === record.vacancyId,
      )!;
      expect(record.criteria.map((c) => c.id)).toEqual(
        stored.criteria.map((c) => c.id),
      );
      expect(record.criteria.map((c) => c.text)).toEqual(
        stored.criteria.map((c) => c.text),
      );
      for (const c of record.criteria) {
        expect(c.score).toBe(80);
        expect(c.quotes.length).toBeGreaterThan(0);
      }
    }

    const lines = (await readFile(cachePath, 'utf8')).trimEnd().split('\n');
    expect(lines).toHaveLength(JOBS);
    expect(await tableFingerprints()).toEqual(before);
    await app.close();
    contexts.pop();

    // second run: everything cached, zero LLM calls
    const meter2 = new SeedMeter(DEFAULT_PRICING);
    const app2 = await bootEval(meter2);
    const again = await runScoringEval(app2, dataset, {
      ...options,
      meter: meter2,
    });
    expect(again.counts).toEqual({
      planned: JOBS,
      done: 0,
      failed: 0,
      skipped: JOBS,
      notStarted: 0,
    });
    expect(again.records.map((r) => r.key)).toEqual(
      out.records.map((r) => r.key),
    );
    expect(meter2.chatCalls).toBe(0);
    expect(meter2.embeddingCallCount).toBe(0);
    expect(
      (await readFile(cachePath, 'utf8')).trimEnd().split('\n'),
    ).toHaveLength(JOBS);
    expect(await tableFingerprints()).toEqual(before);
  });

  it('stops on a tiny budget with nothing started and says so', async () => {
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    const before = await tableFingerprints();

    const out = await runScoringEval(app, dataset, {
      pairs: PAIRS,
      noise: NOISE,
      cachePath: join(dir, 'budget', 'scores.jsonl'),
      maxUsd: 0.001,
      meter,
      log: () => undefined,
    });

    expect(out.stopped).toBe('budget');
    expect(out.counts).toMatchObject({ done: 0, notStarted: JOBS });
    expect(out.records).toEqual([]);
    expect(meter.chatCalls).toBe(0);
    expect(meter.embeddingCallCount).toBe(0);
    expect(await tableFingerprints()).toEqual(before);
  });

  it('stops part-way: finished jobs are cached and a later run resumes the rest', async () => {
    const cachePath = join(dir, 'partial', 'scores.jsonl');
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    // Room for a few jobs: each job is estimated at $0.00845.
    const first = await runScoringEval(app, dataset, {
      pairs: PAIRS,
      noise: NOISE,
      cachePath,
      concurrency: 1,
      maxUsd: 0.03,
      meter,
      log: () => undefined,
    });
    expect(first.stopped).toBe('budget');
    expect(first.counts.done).toBeGreaterThan(0);
    expect(first.counts.done + first.counts.notStarted).toBe(JOBS);
    expect(first.spentUsd).toBeLessThanOrEqual(0.03);

    const rest = await runScoringEval(app, dataset, {
      pairs: PAIRS,
      noise: NOISE,
      cachePath,
      maxUsd: 5,
      meter,
      log: () => undefined,
    });
    expect(rest.stopped).toBeNull();
    expect(rest.counts.skipped).toBe(first.counts.done);
    expect(rest.counts.done).toBe(JOBS - first.counts.done);
    expect(rest.records).toHaveLength(JOBS);
  });
});
