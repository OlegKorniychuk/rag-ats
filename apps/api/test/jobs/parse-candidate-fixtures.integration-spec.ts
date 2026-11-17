import { randomUUID } from 'crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test, type TestingModule } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import { ClsModule } from 'nestjs-cls';
import { EnvConfig } from '../../src/config/env.config.js';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import {
  captureGithubRequests,
  githubCatchAllNotFoundHandler,
} from '../msw/github.handlers.js';
import {
  captureOpenaiRequests,
  openaiEmbeddingsHandler,
  openaiProfileHandler,
  type MockProfile,
} from '../msw/openai.handlers.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

import type { GithubFixture } from '../../src/github/fixture-github-client.js';
import { GithubClient } from '../../src/github/github-client.js';
import { FixtureGithubClient } from '../../src/github/fixture-github-client.js';

const PROFILE: MockProfile = {
  skills: ['TypeScript'],
  experience: '3 years of backend development',
  projects: ['fixture-repo'],
  summary: 'Backend engineer.',
};

const USERNAME = 'fixture-jane';
const FIXTURE: GithubFixture = {
  user: {
    login: USERNAME,
    html_url: `https://github.com/${USERNAME}`,
    bio: 'Fixture bio about Rust services.',
  },
  repos: [
    {
      name: 'fixture-repo',
      html_url: `https://github.com/${USERNAME}/fixture-repo`,
      description: 'A fixture repo',
      language: 'Rust',
      stargazers_count: 7,
      topics: ['rust'],
      pushed_at: '2026-01-01T00:00:00Z',
      fork: false,
      archived: false,
    },
  ],
  readmes: { 'fixture-repo': 'Fixture repo README about parsing CVs.' },
};

// OpenAI is mocked. Any GitHub API request is a bug here: the fixture client
// must answer everything from disk, so the catch-all handler records requests
// and the test asserts none were made.
const server = setupServer(
  githubCatchAllNotFoundHandler(),
  openaiEmbeddingsHandler(),
);
const capture = captureOpenaiRequests();
const githubCapture = captureGithubRequests();

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting; last value: ${JSON.stringify(value)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('CV parse with GITHUB_FIXTURES_DIR (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule | undefined;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;
  let fixturesRoot: string;
  let fixturesDir: string;

  async function boot() {
    @Global()
    @Module({
      providers: [{ provide: DRIZZLE, useValue: testDb.db }],
      exports: [DRIZZLE],
    })
    class TestDbModule {}

    const config = {
      DATABASE_URL: 'postgres://unused',
      OPENAI_API_KEY: 'sk-test-dummy',
      OPENAI_MODEL: 'test-model',
      OPENAI_EMBEDDING_MODEL: 'test-embedding-model',
      JOBS_POLL_INTERVAL_SECONDS: 0.5,
      GITHUB_FIXTURES_DIR: fixturesDir,
    } as EnvConfig;

    @Global()
    @Module({
      providers: [{ provide: EnvConfig, useValue: config }],
      exports: [EnvConfig],
    })
    class TestConfigModule {}

    moduleRef = await Test.createTestingModule({
      imports: [
        TestConfigModule,
        TestDbModule,
        ClsModule.forRoot({
          global: true,
          plugins: [
            new ClsPluginTransactional({
              imports: [TestDbModule],
              adapter: new TransactionalAdapterDrizzleOrm({
                drizzleInstanceToken: DRIZZLE,
              }),
            }),
          ],
        }),
        RepositoriesModule,
        JobsModule,
      ],
    }).compile();
    await moduleRef.init();
  }

  async function seedCandidate(githubUrl: string) {
    const candidate = await candidates.create({
      name: 'Jane Fixture',
      email: `${randomUUID()}@example.com`,
      githubUrl,
      portfolioUrl: null,
      skills: [],
      experience: '',
      projects: [],
      summary: '',
    });
    const text = 'Jane Fixture, backend developer';
    const content = Buffer.from(text);
    const cv = await cvDocuments.create({
      candidateId: candidate.id,
      filename: 'cv.pdf',
      sizeBytes: content.length,
      content,
      text,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    return { candidateId: candidate.id, cvId: cv.id };
  }

  beforeAll(async () => {
    fixturesRoot = await mkdtemp(join(tmpdir(), 'parse-fixtures-'));
    fixturesDir = join(fixturesRoot, 'github');
    await mkdir(fixturesDir);
    await writeFile(
      join(fixturesDir, `${USERNAME}.json`),
      JSON.stringify(FIXTURE),
    );
    testDb = await createTestDatabase();
    server.listen({ onUnhandledFrame: 'error' });
    server.events.on('request:start', capture.listener);
    server.events.on('request:start', githubCapture.listener);
    await boot();
    candidates = moduleRef!.get(CANDIDATES_REPOSITORY);
    cvDocuments = moduleRef!.get(CV_DOCUMENTS_REPOSITORY);
  }, 180_000);

  afterEach(() => {
    capture.bodies.length = 0;
    githubCapture.requests.length = 0;
  });

  afterAll(async () => {
    await moduleRef?.close();
    server.close();
    await teardownTestDatabase(testDb);
    await rm(fixturesRoot, { recursive: true, force: true });
  });

  it('wires the fixture client into the app', () => {
    const client = moduleRef!.get(GithubClient);
    expect(client).toBeInstanceOf(FixtureGithubClient);
  });

  it('saves a GitHub snapshot from the fixture without calling GitHub', async () => {
    server.use(openaiProfileHandler(PROFILE));
    const { candidateId, cvId } = await seedCandidate(
      `https://github.com/${USERNAME}`,
    );

    await moduleRef!.get(JobsService).enqueueParse(candidateId, cvId);
    await waitFor(
      () => candidates.findById(candidateId),
      (c) => c?.parseStatus === 'parsed',
    );

    const { rows } = await testDb.pool.query<{ github_snapshot: any }>(
      'SELECT github_snapshot FROM candidates WHERE id = $1',
      [candidateId],
    );
    const snapshot = rows[0].github_snapshot;
    expect(snapshot).toMatchObject({
      username: USERNAME,
      status: 'ok',
      bio: FIXTURE.user.bio,
      languages: [{ name: 'Rust', repoCount: 1 }],
    });
    expect(snapshot.repos).toHaveLength(1);
    expect(snapshot.repos[0]).toMatchObject({
      name: 'fixture-repo',
      stars: 7,
      readmeExcerpt: 'Fixture repo README about parsing CVs.',
    });

    const user = capture.bodies[0].input.find((m: any) => m.role === 'user');
    expect(user.content).toContain('Fixture bio about Rust services.');
    expect(githubCapture.requests).toEqual([]);
  });

  it('records not_found for a username without a fixture', async () => {
    server.use(openaiProfileHandler(PROFILE));
    const { candidateId, cvId } = await seedCandidate(
      'https://github.com/nobody-here',
    );

    await moduleRef!.get(JobsService).enqueueParse(candidateId, cvId);
    await waitFor(
      () => candidates.findById(candidateId),
      (c) => c?.parseStatus === 'parsed',
    );

    const { rows } = await testDb.pool.query<{ github_snapshot: any }>(
      'SELECT github_snapshot FROM candidates WHERE id = $1',
      [candidateId],
    );
    expect(rows[0].github_snapshot).toMatchObject({
      username: 'nobody-here',
      status: 'not_found',
    });
    expect(githubCapture.requests).toEqual([]);
  });
});
