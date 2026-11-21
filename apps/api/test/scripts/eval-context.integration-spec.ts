import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'pg';
import { CandidateSearchService } from '../../src/candidates/search/candidate-search.service.js';
import { PG_BOSS } from '../../src/jobs/jobs.tokens.js';
import { DEFAULT_PRICING } from '../../src/scripts/parse-eval/cost.js';
import { createEvalContext } from '../../src/scripts/eval/app.js';
import type { SyntheticSet } from '../../src/scripts/eval/data.js';
import { loadEvalDataset, preflight } from '../../src/scripts/eval/dataset.js';
import { PreflightError } from '../../src/scripts/eval/preflight.js';
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

describe('eval context (Testcontainers + MSW)', () => {
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
        builder.overrideProvider(DRIZZLE).useValue(testDb.db),
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

  it('starts no pg-boss, no workers, and writes no rows', async () => {
    expect(await pgbossSchemaExists()).toBe(false);
    const before = await tableFingerprints();
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);

    // no job queue provider at all, so nothing can start a worker
    expect(() => app.get(PG_BOSS)).toThrow();

    // the context is usable: preflight reads, search embeds the query
    // through the metered client and reads the chunks
    const { problems } = await preflight(app, syntheticSet());
    expect(problems).toEqual([]);
    const hits = await app.get(CandidateSearchService).search('rust services');
    expect(Array.isArray(hits)).toBe(true);
    expect(meter.embeddingCallCount).toBe(1);
    expect(meter.chatCalls).toBe(0);

    // give a (wrongly) started pg-boss time to create its schema or poll
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await pgbossSchemaExists()).toBe(false);
    expect(await tableFingerprints()).toEqual(before);
  });

  it('passes the preflight on the mini set and returns the dataset', async () => {
    const app = await bootEval(new SeedMeter(DEFAULT_PRICING));

    const dataset = await loadEvalDataset(app, syntheticSet());

    expect(dataset.personas.map((p) => p.id)).toEqual(['e1', 'e2', 'e3']);
    expect(dataset.vacancies.map((v) => v.spec.id)).toEqual(['alpha', 'beta']);
    for (const v of dataset.vacancies) {
      expect(v.criteria.length).toBeGreaterThan(0);
      expect(dataset.specIdByVacancyId.get(v.id)).toBe(v.spec.id);
    }
    const { rows } = await pool.query<{ id: string; email: string }>(
      'SELECT id, email FROM candidates ORDER BY email',
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const personaId = row.email.split('@')[0];
      expect(dataset.candidateIdByPersonaId.get(personaId)).toBe(row.id);
      expect(dataset.personaIdByCandidateId.get(row.id)).toBe(personaId);
    }
    expect(dataset.spotCheck).toEqual([
      { pair: 1, vacancyId: 'alpha', personaId: 'e1', band: 'strong' },
    ]);
  });

  it('reports a missing candidate and a missing vacancy, all at once', async () => {
    const app = await bootEval(new SeedMeter(DEFAULT_PRICING));
    const set = syntheticSet({
      personas: [...MINI_SET, persona('ghost', ['alpha'])],
      vacancies: [...VACANCIES, vacancy('gamma')],
    });

    const { problems } = await preflight(app, set);
    expect(problems).toEqual([
      'persona ghost (ghost@example.com): no candidate with this email',
      'vacancy gamma ("Seed vacancy gamma"): not found for recruiter seed@example.com',
    ]);

    await expect(loadEvalDataset(app, set)).rejects.toThrow(PreflightError);
  });

  it('reports a candidate whose chunks are not embedded for the parsed CV', async () => {
    const app = await bootEval(new SeedMeter(DEFAULT_PRICING));
    await pool.query(
      `UPDATE candidates SET embedded_cv_document_id = NULL WHERE email = 'e2@example.com'`,
    );
    try {
      const { problems } = await preflight(app, syntheticSet());
      expect(problems).toEqual([
        'persona e2 (e2@example.com): chunks are not embedded for the parsed CV',
      ]);
    } finally {
      await pool.query(
        `UPDATE candidates SET embedded_cv_document_id = parsed_cv_document_id WHERE email = 'e2@example.com'`,
      );
    }
  });
});
