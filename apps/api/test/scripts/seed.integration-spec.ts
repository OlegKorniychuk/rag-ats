import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { Pool } from 'pg';
import { DEFAULT_PRICING } from '../../src/scripts/parse-eval/cost.js';
import { CV_PROFILE_SCHEMA_NAME } from '../../src/llm/cv-profile.schema.js';
import { APPLICATION_SCORE_SCHEMA_NAME } from '../../src/llm/application-score.schema.js';
import { VACANCY_CRITERIA_SCHEMA_NAME } from '../../src/llm/vacancy-criteria.schema.js';
import { SeedMeter } from '../../src/scripts/seed/metering.js';
import { runSeed, type RunSeedResult } from '../../src/scripts/seed/run.js';
import { isDrained, summarize } from '../../src/scripts/seed/snapshot.js';
import type {
  PersonaSpec,
  VacancySpec,
} from '../../src/scripts/synth/types.js';
import type { EnvConfig } from '../../src/config/env.config.js';
import type { GithubFixture } from '../../src/github/fixture-github-client.js';
import { onUnhandledFrame, server } from '../msw/server.js';
import { captureGithubRequests } from '../msw/github.handlers.js';
import { textPdf } from '../pdf.util.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

const GITHUB_USERNAME = 'seed-jane';
const GITHUB_FIXTURE: GithubFixture = {
  user: {
    login: GITHUB_USERNAME,
    html_url: `https://github.com/${GITHUB_USERNAME}`,
    bio: 'Seed fixture bio about Rust services.',
  },
  repos: [
    {
      name: 'seed-repo',
      html_url: `https://github.com/${GITHUB_USERNAME}/seed-repo`,
      description: 'A seed fixture repo',
      language: 'Rust',
      stargazers_count: 7,
      topics: ['rust'],
      pushed_at: '2026-01-01T00:00:00Z',
      fork: false,
      archived: false,
    },
  ],
  readmes: { 'seed-repo': 'Seed fixture README.' },
};

const vacancy = (id: string): VacancySpec => ({
  id,
  title: `Seed vacancy ${id}`,
  intro: '',
  requirements: [],
  text: `- 3+ years of ${id}\n- Good communication`,
});

const persona = (
  id: string,
  applyTo: string[],
  github: string | null = null,
): PersonaSpec => ({
  id,
  name: `Persona ${id}`,
  email: `${id}@example.com`,
  language: 'en',
  layout: '1-col',
  roles: [],
  projects: [],
  skills: [],
  github: github ? { username: github } : null,
  kind: 'targeted',
  flags: [],
  applyTo,
});

const VACANCIES = [vacancy('alpha'), vacancy('beta')];
const MINI_SET = [
  persona('s1', ['alpha', 'beta'], GITHUB_USERNAME),
  persona('s2', ['alpha', 'beta']),
  persona('s3', ['beta']),
];
// A second set for the budget test (emails are unique across the database).
const BUDGET_SET = [
  persona('b1', ['alpha', 'beta']),
  persona('b2', ['alpha', 'beta']),
  persona('b3', ['alpha', 'beta']),
  persona('b4', ['alpha', 'beta']),
];

describe('db:seed core (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let dir: string;
  let pool: Pool;
  let contexts: INestApplicationContext[] = [];
  const githubCapture = captureGithubRequests();

  async function boot(meter: SeedMeter): Promise<INestApplicationContext> {
    // AppModule validates process.env as soon as it is imported (see
    // jest-e2e-setup.ts), so the vars are set first and the import is lazy.
    process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/unused';
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.NODE_ENV ??= 'test';
    process.env.OPENAI_API_KEY ??= 'test-key';
    const { createSeedContext } = await import('../../src/scripts/seed/app.js');
    const { DRIZZLE } = await import('../../src/db/db.tokens.js');
    const env = {
      DATABASE_URL: 'postgres://unused',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      PORT: 0,
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
      OPENAI_API_KEY: 'sk-test-dummy',
      OPENAI_MODEL: 'gpt-5.4-mini',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      SCORING_MODE: 'full_text',
      JOBS_POLL_INTERVAL_SECONDS: 0.5,
      GITHUB_FIXTURES_DIR: join(dir, 'github'),
    } as EnvConfig;
    const app = await createSeedContext({
      env,
      meter,
      customize: (builder) =>
        builder.overrideProvider(DRIZZLE).useValue(testDb.db),
    });
    contexts.push(app);
    return app;
  }

  const seed = (
    app: INestApplicationContext,
    meter: SeedMeter,
    personas: PersonaSpec[],
    overrides: Partial<Parameters<typeof runSeed>[1]> = {},
  ): Promise<RunSeedResult> =>
    runSeed(app, {
      dir,
      personas,
      vacancies: VACANCIES,
      recruiterPassword: 'integration-test-password',
      maxUsd: 100,
      timeoutMs: 60_000,
      concurrency: 2,
      pollMs: 100,
      meter,
      ...overrides,
    });

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(sql, params);
    return Number(rows[0].n);
  }

  async function closeContexts() {
    for (const app of contexts) await app.close();
    contexts = [];
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'seed-it-'));
    await mkdir(join(dir, 'pdf'));
    await mkdir(join(dir, 'github'));
    for (const p of [...MINI_SET, ...BUDGET_SET]) {
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
    server.events.on('request:start', githubCapture.listener);
  }, 180_000);

  afterAll(async () => {
    await closeContexts();
    server.close();
    await teardownTestDatabase(testDb);
    await rm(dir, { recursive: true, force: true });
  });

  it('seeds a mini set, resumes as a no-op, and reuses the CV of a second application', async () => {
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await boot(meter);

    const result = await seed(app, meter, MINI_SET);

    // every candidate is parsed, embedded, and every score is scored
    expect(result.stopped).toBeNull();
    expect(result.submitErrors).toEqual([]);
    expect(isDrained(result.snapshot)).toBe(true);
    expect(summarize(result.snapshot)).toMatchObject({
      candidates: 3,
      parsed: 3,
      failedParses: 0,
      embedded: 3,
      applications: 5,
      scored: 5,
      failedScores: 0,
      scoresPending: 0,
    });

    // recruiter and vacancies exist once
    expect(await count('SELECT count(*) AS n FROM recruiters')).toBe(1);
    expect(await count('SELECT count(*) AS n FROM vacancies')).toBe(2);

    // the GitHub persona's snapshot comes from the fixture, never from GitHub
    const { rows } = await pool.query<{ github_snapshot: any }>(
      'SELECT github_snapshot FROM candidates WHERE email = $1',
      ['s1@example.com'],
    );
    expect(rows[0].github_snapshot).toMatchObject({
      username: GITHUB_USERNAME,
      status: 'ok',
      bio: GITHUB_FIXTURE.user.bio,
    });
    expect(githubCapture.requests).toEqual([]);

    // the second application of s1 reused its CV: one document, one parse per persona
    expect(
      await count(
        `SELECT count(*) AS n FROM cv_documents d
           JOIN candidates c ON c.id = d.candidate_id WHERE c.email = $1`,
        ['s1@example.com'],
      ),
    ).toBe(1);
    expect(meter.calls(CV_PROFILE_SCHEMA_NAME)).toBe(3);
    expect(meter.calls(VACANCY_CRITERIA_SCHEMA_NAME)).toBe(2);
    expect(meter.calls(APPLICATION_SCORE_SCHEMA_NAME)).toBe(5);
    expect(meter.spentUsd).toBeGreaterThan(0);

    // re-running changes nothing and calls no model
    const callsBefore = meter.chatCalls;
    const embedCallsBefore = meter.embeddingCallCount;
    const rerun = await seed(app, meter, MINI_SET);
    expect(rerun.stopped).toBeNull();
    expect(rerun.submitErrors).toEqual([]);
    expect(await count('SELECT count(*) AS n FROM applications')).toBe(5);
    expect(await count('SELECT count(*) AS n FROM cv_documents')).toBe(3);
    expect(await count('SELECT count(*) AS n FROM vacancies')).toBe(2);
    expect(meter.chatCalls).toBe(callsBefore);
    expect(meter.embeddingCallCount).toBe(embedCallsBefore);
    expect(summarize(rerun.snapshot).scored).toBe(5);

    await closeContexts();
  });

  it('stops submitting at the budget cap, drains what was submitted, and reports it', async () => {
    const meter = new SeedMeter(DEFAULT_PRICING);
    const app = await boot(meter);

    // Room for the criteria and the first persona (about $0.015 estimated), not for a second.
    const result = await seed(app, meter, BUDGET_SET, {
      maxUsd: 0.02,
      concurrency: 1,
    });

    expect(result.stopped).toBe('budget');
    const counts = summarize(result.snapshot);
    expect(counts.applications).toBeGreaterThan(0);
    expect(counts.applications).toBeLessThan(8);
    // what was submitted still finished
    expect(isDrained(result.snapshot)).toBe(true);
    expect(counts.scoresPending).toBe(0);
    expect(meter.spentUsd).toBeLessThanOrEqual(0.02);
    // the cap holds back parses too: not every persona got a candidate
    expect(counts.candidates).toBeLessThan(4);
  });
});
