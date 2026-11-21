import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'pg';
import { SEARCH_MIN_SIMILARITY } from '../../src/candidates/search/search.constants.js';
import { DEFAULT_PRICING } from '../../src/scripts/parse-eval/cost.js';
import { createEvalContext } from '../../src/scripts/eval/app.js';
import type { SyntheticSet } from '../../src/scripts/eval/data.js';
import { loadEvalDataset } from '../../src/scripts/eval/dataset.js';
import { runRetrievalEval } from '../../src/scripts/eval/retrieval.js';
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

const syntheticSet = (overrides: Partial<SyntheticSet> = {}): SyntheticSet => ({
  personas: MINI_SET,
  vacancies: VACANCIES,
  groundTruth: {
    pairs: [
      {
        vacancyId: 'alpha',
        personaId: 'e1',
        score: 90,
        band: 'strong',
        requirements: [],
      },
      {
        vacancyId: 'beta',
        personaId: 'e3',
        score: 10,
        band: 'weak',
        requirements: [],
      },
    ],
  },
  queries: [
    {
      id: 'q1',
      query: 'rust',
      tags: [],
      relevant: ['e1'],
      partiallyRelevant: ['e2'],
    },
  ],
  taxonomy: { description: '', tags: [] },
  spotCheckLabels: [
    { pair: 1, vacancyId: 'alpha', personaId: 'e1', band: 'strong', note: '' },
  ],
  ...overrides,
});

describe('retrieval eval (Testcontainers + MSW)', () => {
  let testDb: TestDatabase;
  let dir: string;
  let pool: Pool;
  const contexts: INestApplicationContext[] = [];

  /** Every table's rows as one hash, so an insert, update or delete shows. */
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

  async function pgbossSchemaExists(): Promise<boolean> {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss'`,
    );
    return rows.length > 0;
  }

  async function bootEval(meter: SeedMeter): Promise<INestApplicationContext> {
    const { DRIZZLE } = await import('../../src/db/db.tokens.js');
    const app = await createEvalContext({
      env: testEnv(join(dir, 'github')),
      meter,
      customize: (builder) =>
        builder
          .overrideProvider(DRIZZLE)
          .useValue(testDb.db)
          // the fake embedding model (keyword overlap) scores far below a
          // real one, so the production 0.3 floor would return nothing
          .overrideProvider(SEARCH_MIN_SIMILARITY)
          .useValue(0),
    });
    contexts.push(app);
    return app;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'eval-it-'));
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

    // Seed the mini set with the real seed (its context runs pg-boss and the
    // workers), then close it and drop the queue schema it created, so the
    // eval context below starts from a database with no pg-boss at all.
    process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused';
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.NODE_ENV ??= 'test';
    process.env.OPENAI_API_KEY ??= 'test-key';
    const { createSeedContext } = await import('../../src/scripts/seed/app.js');
    const { DRIZZLE } = await import('../../src/db/db.tokens.js');
    const meter = new SeedMeter(DEFAULT_PRICING);
    const seedApp = await createSeedContext({
      env: testEnv(join(dir, 'github')),
      meter,
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
      meter,
    });
    expect(result.stopped).toBeNull();
    expect(isDrained(result.snapshot)).toBe(true);
    await seedApp.close();
    await pool.query('DROP SCHEMA IF EXISTS pgboss CASCADE');
  }, 180_000);

  afterEach(async () => {
    for (const app of contexts.splice(0)) await app.close();
  });

  afterAll(async () => {
    server.close();
    await teardownTestDatabase(testDb);
    await rm(dir, { recursive: true, force: true });
  });

  it('ranks the pool through embeddings only, and writes nothing', async () => {
    expect(await pgbossSchemaExists()).toBe(false);
    const before = await tableFingerprints();
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    const dataset = await loadEvalDataset(app, syntheticSet());

    const result = await runRetrievalEval(app, dataset, {
      matchFloors: { criteria: 0, wholeText: 0 },
    });

    // search: one query, the whole mini pool comes back at floor 0
    expect(result.search.productionFloor).toBe(0);
    expect(result.search.queries).toHaveLength(1);
    const [q1] = result.search.queries;
    expect(q1.queryId).toBe('q1');
    expect([...q1.ranked].sort()).toEqual(['e1', 'e2', 'e3']);
    expect(q1.unmapped).toBe(0);
    expect(q1.metrics.p5).toBeCloseTo(2 / 5);
    expect(result.search.sweep.map((r) => r.floor)).toEqual([
      0.2, 0.25, 0.3, 0.35,
    ]);
    for (const row of result.search.sweep) {
      expect(row.queries).toHaveLength(1);
      expect(row.queries[0].returned).toBeLessThanOrEqual(3);
    }

    // matches: both modes, both vacancies, ranked over the whole pool (3)
    expect(result.settings.matches.maxCandidates).toBe(3);
    for (const mode of ['criteria', 'whole_text'] as const) {
      const { vacancies, returned } = result.matches[mode];
      expect(vacancies.map((v) => v.vacancyId)).toEqual(['alpha', 'beta']);
      expect(returned).toBe(3);
      for (const v of vacancies) {
        expect([...v.ranked].sort()).toEqual(['e1', 'e2', 'e3']);
      }
      // alpha has one strong persona (e1), beta only a weak one (e3):
      // beta has nothing relevant, so its metrics are undefined
      expect(vacancies[0].metrics.r10).toBe(1);
      expect(vacancies[1].metrics.r10).toBeNull();
      // G5: e3 is weak for beta and inside the top 10 of 3
      expect(vacancies[1].weakInTop10).toBe(1);
      expect(vacancies[1].weakShareTop10).toBeCloseTo(1 / 3);
      expect(result.g5[mode].worst).toHaveLength(1);
      expect(result.g5[mode].worst[0]).toMatchObject({
        personaId: 'e3',
        vacancyId: 'beta',
      });
    }
    // criteria mode names what it matched
    expect(result.g5.criteria.worst[0].matchedCriteria.length).toBeGreaterThan(
      0,
    );

    // 1 query + (1 criteria call + 1 whole-text call) x 2 vacancies; no chat
    expect(meter.embeddingCallCount).toBe(5);
    expect(meter.chatCalls).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await pgbossSchemaExists()).toBe(false);
    expect(await tableFingerprints()).toEqual(before);
  });
});
