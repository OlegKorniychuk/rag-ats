import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'pg';
import { INTERVIEW_QUESTIONS_SCHEMA_NAME } from '../../src/llm/interview-questions.schema.js';
import { createEvalContext } from '../../src/scripts/eval/app.js';
import type { SyntheticSet } from '../../src/scripts/eval/data.js';
import { loadEvalDataset } from '../../src/scripts/eval/dataset.js';
import type { EvalDataset } from '../../src/scripts/eval/preflight.js';
import { DEFAULT_PRICING } from '../../src/scripts/parse-eval/cost.js';
import {
  findQuestionsCandidates,
  runQuestionsEval,
  writeQuestionsEvalFiles,
} from '../../src/scripts/questions-eval/run.js';
import { sampleScoredApplications } from '../../src/scripts/questions-eval/sample.js';
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

const truthPair = (
  vacancyId: string,
  personaId: string,
  band: 'strong' | 'partial' | 'weak',
) => ({ vacancyId, personaId, score: 50, band, requirements: [] });

const syntheticSet = (): SyntheticSet => ({
  personas: MINI_SET,
  vacancies: VACANCIES,
  groundTruth: {
    pairs: [
      truthPair('alpha', 'e1', 'strong'),
      truthPair('alpha', 'e2', 'partial'),
      truthPair('beta', 'e1', 'partial'),
      truthPair('beta', 'e2', 'weak'),
      truthPair('beta', 'e3', 'weak'),
    ],
  },
  queries: [],
  taxonomy: { description: '', tags: [] },
  spotCheckLabels: [],
});

describe('questions eval (Testcontainers + MSW)', () => {
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
    dir = await mkdtemp(join(tmpdir(), 'questions-eval-it-'));
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

  it('finds the scored applications with their bands and makes no LLM call (dry run)', async () => {
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);

    const candidates = await findQuestionsCandidates(app, dataset);

    expect(
      candidates
        .map((c) => `${c.vacancySpecId}/${c.personaId}/${c.band}`)
        .sort(),
    ).toEqual([
      'alpha/e1/strong',
      'alpha/e2/partial',
      'beta/e1/partial',
      'beta/e2/weak',
      'beta/e3/weak',
    ]);
    expect(meter.chatCalls).toBe(0);
  });

  it('generates questions for the sample, writes json, md and review files, and changes no rows', async () => {
    const before = await tableFingerprints();
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    const items = sampleScoredApplications(
      await findQuestionsCandidates(app, dataset),
      1,
      42,
    );
    expect(items.map((i) => i.band)).toEqual(['strong', 'partial', 'weak']);

    const out = await runQuestionsEval(app, items, {
      maxUsd: 1,
      meter,
      log: () => undefined,
    });

    expect(out.stopped).toBeNull();
    expect(out.records).toHaveLength(3);
    expect(meter.calls(INTERVIEW_QUESTIONS_SCHEMA_NAME)).toBe(3);
    for (const record of out.records) {
      expect(record).toMatchObject({
        status: 'ok',
        attempts: 1,
        error: null,
        inputTokens: 1200,
        outputTokens: 300,
      });
      expect(record.questions.map((q) => q.basis)).toEqual(['fact', 'gap']);
      expect(Object.keys(record.criterionScores).length).toBeGreaterThan(0);
    }

    const files = await writeQuestionsEvalFiles({
      dir: join(dir, 'out'),
      label: 'q-it',
      records: out.records,
      pricing: DEFAULT_PRICING,
      meta: {
        model: 'gpt-5.4-mini',
        perBand: 1,
        seed: 42,
        spentUsd: meter.spentUsd,
        startedAt: '2026-11-21T10:00:00.000Z',
      },
      reviewCount: 25,
    });
    const json = JSON.parse(await readFile(files.jsonPath, 'utf8'));
    expect(json.records).toHaveLength(3);
    expect(json.metrics.ok).toBe(3);
    expect(await readFile(files.mdPath, 'utf8')).toContain(
      '# Interview questions eval: q-it',
    );
    const review = await readFile(files.reviewPath, 'utf8');
    expect(
      review.split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l)),
    ).toHaveLength(6);
    expect(await tableFingerprints()).toEqual(before);
  });

  it('stops on a tiny budget before any call', async () => {
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await bootEval(meter);
    const items = await findQuestionsCandidates(app, dataset);

    const out = await runQuestionsEval(app, items, {
      maxUsd: 0.001,
      meter,
      log: () => undefined,
    });

    expect(out.stopped).toBe('budget');
    expect(out.records).toEqual([]);
    expect(meter.chatCalls).toBe(0);
  });
});
