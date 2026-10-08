import { randomUUID } from 'crypto';
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
import { ParseCandidateWorker } from '../../src/jobs/parse-candidate.worker.js';
import {
  captureOpenaiRequests,
  openaiErrorHandler,
  openaiProfileHandler,
  openaiRefusalHandler,
  type MockProfile,
} from '../msw/openai.handlers.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

const PROFILE: MockProfile = {
  skills: ['TypeScript', 'NestJS'],
  experience: '5 years of backend development',
  projects: ['RAG-ATS'],
  summary: 'Backend engineer.',
};

// OpenAI is the only HTTP dependency; unhandled requests fail the test.
const server = setupServer();
const capture = captureOpenaiRequests();

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

describe('CV parse jobs (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule | undefined;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;

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
      JOBS_POLL_INTERVAL_SECONDS: 0.5,
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

    candidates = moduleRef.get(CANDIDATES_REPOSITORY);
    cvDocuments = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
  }

  async function shutdown() {
    await moduleRef?.close();
    moduleRef = undefined;
  }

  async function seedCandidate(
    cvTexts: string[] = ['Jane Doe, backend developer'],
  ) {
    const candidate = await candidates.create({
      name: 'Jane Doe',
      email: `${randomUUID()}@example.com`,
      githubUrl: 'https://github.com/janedoe',
      portfolioUrl: null,
      skills: [],
      experience: '',
      projects: [],
      summary: '',
    });
    const cvIds: string[] = [];
    for (const [index, text] of cvTexts.entries()) {
      cvIds.push(await addCv(candidate.id, text, index));
    }
    return { candidateId: candidate.id, cvIds };
  }

  async function addCv(candidateId: string, text: string, order: number) {
    const content = Buffer.from(text);
    const cv = await cvDocuments.create({
      candidateId,
      filename: 'cv.pdf',
      sizeBytes: content.length,
      content,
      text,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, order)),
    });
    return cv.id;
  }

  const readState = (candidateId: string) => candidates.findById(candidateId);

  function waitForStatus(candidateId: string, status: string) {
    return waitFor(
      () => readState(candidateId),
      (c) => c?.parseStatus === status,
    );
  }

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server.listen({ onUnhandledFrame: 'error' });
    server.events.on('request:start', capture.listener);
  }, 120_000);

  afterEach(() => {
    server.resetHandlers();
    capture.bodies.length = 0;
  });

  afterAll(async () => {
    await shutdown();
    server.close();
    await teardownTestDatabase(testDb);
  });

  describe('worker', () => {
    beforeAll(async () => {
      await boot();
    }, 60_000);
    afterAll(shutdown);

    it('parses an enqueued CV and writes the profile', async () => {
      server.use(openaiProfileHandler(PROFILE));
      const { candidateId, cvIds } = await seedCandidate();

      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvIds[0]);
      const parsed = await waitForStatus(candidateId, 'parsed');

      expect(parsed).toMatchObject({ ...PROFILE, parseError: null });
      expect(capture.bodies).toHaveLength(1);
      const state = await candidates.findParseState(candidateId);
      expect(state?.parsedCvDocumentId).toBe(cvIds[0]);
    });

    it('runs outside a request: handle() provides its own CLS context', async () => {
      server.use(openaiProfileHandler(PROFILE));
      const { candidateId, cvIds } = await seedCandidate();

      await moduleRef!
        .get(ParseCandidateWorker)
        .handle({ candidateId, cvDocumentId: cvIds[0] });

      expect((await readState(candidateId))?.parseStatus).toBe('parsed');
    });

    it('records the LlmParseError message when the model refuses', async () => {
      server.use(openaiRefusalHandler());
      const { candidateId, cvIds } = await seedCandidate();

      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvIds[0]);
      const failed = await waitForStatus(candidateId, 'failed');

      expect(failed?.parseError).toBe(
        'The model could not extract a profile from the CV',
      );
    });

    it('records a generic message (no SDK/HTTP details) on API errors', async () => {
      server.use(openaiErrorHandler(500));
      const { candidateId, cvIds } = await seedCandidate();

      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvIds[0]);
      const failed = await waitForStatus(candidateId, 'failed');

      expect(failed?.parseError).toBe('Could not parse the CV');
    });

    it('skips a stale job for an older CV, and the newer CV parses', async () => {
      server.use(openaiProfileHandler(PROFILE));
      const { candidateId, cvIds } = await seedCandidate([
        'old cv text',
        'new cv text',
      ]);
      const worker = moduleRef!.get(ParseCandidateWorker);

      await worker.handle({ candidateId, cvDocumentId: cvIds[0] });

      expect(capture.bodies).toHaveLength(0);
      expect((await readState(candidateId))?.parseStatus).toBe('pending');

      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvIds[1]);
      await waitForStatus(candidateId, 'parsed');
      expect(capture.bodies).toHaveLength(1);
      expect(
        (await candidates.findParseState(candidateId))?.parsedCvDocumentId,
      ).toBe(cvIds[1]);
    });

    it('drops a result when a newer CV arrives while the LLM call is in flight', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let started!: () => void;
      const requestStarted = new Promise<void>(
        (resolve) => (started = resolve),
      );
      server.use(
        openaiProfileHandler(PROFILE, {
          before: async () => {
            started();
            await gate;
          },
        }),
      );
      const { candidateId, cvIds } = await seedCandidate(['old cv text']);
      const worker = moduleRef!.get(ParseCandidateWorker);

      const running = worker.handle({ candidateId, cvDocumentId: cvIds[0] });
      await requestStarted;
      await addCv(candidateId, 'new cv text', 5);
      release();
      await running;

      const state = await candidates.findParseState(candidateId);
      expect(state?.parsedCvDocumentId).toBeNull();
      expect(state?.parseStatus).toBe('parsing');
      expect((await readState(candidateId))?.skills).toEqual([]);
    });

    it('does not regress a candidate a newer job already parsed', async () => {
      server.use(openaiProfileHandler(PROFILE));
      const { candidateId, cvIds } = await seedCandidate();
      // A newer job finished (parsed) between this job's stale check and its
      // status write: simulate by parsing from a different, unrelated CV id.
      await candidates.saveParsedProfile(candidateId, cvIds[0], PROFILE);
      await testDb.pool.query(
        'UPDATE candidates SET parsed_cv_document_id = NULL WHERE id = $1',
        [candidateId],
      );

      await moduleRef!
        .get(ParseCandidateWorker)
        .handle({ candidateId, cvDocumentId: cvIds[0] });

      expect(capture.bodies).toHaveLength(0);
      expect((await readState(candidateId))?.parseStatus).toBe('parsed');
    });

    it('does not call the LLM again for an already-parsed CV', async () => {
      server.use(openaiProfileHandler(PROFILE));
      const { candidateId, cvIds } = await seedCandidate();
      const worker = moduleRef!.get(ParseCandidateWorker);

      await worker.handle({ candidateId, cvDocumentId: cvIds[0] });
      await worker.handle({ candidateId, cvDocumentId: cvIds[0] });
      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvIds[0]);
      // Let the queued duplicate be picked up and finished.
      await new Promise((resolve) => setTimeout(resolve, 2_000));

      expect(capture.bodies).toHaveLength(1);
      expect((await readState(candidateId))?.parseStatus).toBe('parsed');
    });
  });

  describe('startup sweep', () => {
    afterEach(shutdown);

    it('parses candidates left pending/parsing before bootstrap', async () => {
      server.use(openaiProfileHandler(PROFILE));
      // No JobsModule is running here: seed rows directly, then boot.
      // Earlier tests leave in-flight leftovers behind; settle them first.
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'failed' WHERE parse_status IN ('pending', 'parsing')",
      );
      const pending = await seedViaSql();
      const parsing = await seedViaSql();
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'parsing' WHERE id = $1",
        [parsing.candidateId],
      );
      const done = await seedViaSql();
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'failed', parse_error = 'x' WHERE id = $1",
        [done.candidateId],
      );

      await boot();

      await waitForStatus(pending.candidateId, 'parsed');
      await waitForStatus(parsing.candidateId, 'parsed');
      expect(capture.bodies).toHaveLength(2);
      expect((await readState(done.candidateId))?.parseStatus).toBe('failed');
    });
  });

  async function seedViaSql() {
    const candidateId = randomUUID();
    await testDb.pool.query(
      `INSERT INTO candidates (id, name, email, github_url, skills, experience, projects, summary)
       VALUES ($1, 'Sweep Candidate', $2, 'https://github.com/x', '{}', '', '{}', '')`,
      [candidateId, `${candidateId}@example.com`],
    );
    const cv = await testDb.pool.query<{ id: string }>(
      `INSERT INTO cv_documents (candidate_id, filename, size_bytes, content, text)
       VALUES ($1, 'cv.pdf', 3, 'abc', 'cv text') RETURNING id`,
      [candidateId],
    );
    return { candidateId, cvIds: [cv.rows[0].id] };
  }
});
