import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test, type TestingModule } from '@nestjs/testing';
import type {
  ApplicationQuestions,
  QuestionSet,
  ScoreResult,
  VacancyCriterion,
} from '@rag-ats/shared';
import { setupServer } from 'msw/node';
import { ClsModule } from 'nestjs-cls';
import { EnvConfig } from '../../src/config/env.config.js';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  APPLICATIONS_REPOSITORY,
  type ApplicationsRepository,
} from '../../src/db/repositories/applications.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
import {
  QUESTIONS_REPOSITORY,
  type QuestionsRepository,
} from '../../src/db/repositories/questions.repository.js';
import {
  RECRUITERS_REPOSITORY,
  type RecruitersRepository,
} from '../../src/db/repositories/recruiters.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../../src/db/repositories/scores.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../../src/db/repositories/vacancies.repository.js';
import {
  GenerateQuestionsWorker,
  SCORE_CHANGED_ERROR,
  SCORE_NOT_READY_ERROR,
  GENERIC_QUESTIONS_ERROR,
} from '../../src/jobs/generate-questions.worker.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import { normaliseText } from '../../src/llm/cv-profile-parser.js';
import { vacancyCriteriaHash } from '../../src/scoring/criteria-hash.js';
import { cvUnits } from '../../src/scoring/evidence-units.js';
import {
  captureOpenaiRequests,
  fabricatedQuestionsResponse,
  openaiEmbeddingsHandler,
  openaiErrorHandler,
  openaiQuestionsHandler,
  type MockProfile,
} from '../msw/openai.handlers.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

const PROFILE: MockProfile = {
  skills: ['TypeScript', 'Kafka'],
  experience: '5 years of backend development',
  projects: ['RAG-ATS'],
  summary: 'Backend engineer.',
};

const CV_TEXT = [
  'Jane Doe',
  'Built event-driven services with Kafka and Node.js for five years at Acme.',
  'Used Docker Compose for local development only.',
].join('\n');
const UNITS = cvUnits(normaliseText(CV_TEXT));
const KAFKA = UNITS.find((u) => u.text.includes('Kafka'))!;
const DOCKER = UNITS.find((u) => u.text.includes('Docker'))!;

const CRITERIA: VacancyCriterion[] = [
  { id: 'c1', text: 'Event-driven backend', importance: 'must' },
  { id: 'c2', text: 'Kubernetes in production', importance: 'must' },
];

const GROUNDING_ERROR = 'The model cited evidence that could not be resolved';

// OpenAI is the only HTTP dependency; any unmocked request fails the test.
const server = setupServer(openaiEmbeddingsHandler());
const questionsCapture = captureOpenaiRequests('interview_questions');

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 20_000,
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

describe('Questions jobs (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule | undefined;
  let seedRef: TestingModule;
  let questions: QuestionsRepository;
  let scores: ScoresRepository;
  let applications: ApplicationsRepository;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;
  let vacancies: VacanciesRepository;
  let recruiterId: string;

  function testModules() {
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
      SCORING_MODE: 'full_text',
      JOBS_POLL_INTERVAL_SECONDS: 0.5,
    } as EnvConfig;

    @Global()
    @Module({
      providers: [{ provide: EnvConfig, useValue: config }],
      exports: [EnvConfig],
    })
    class TestConfigModule {}

    const cls = ClsModule.forRoot({
      global: true,
      plugins: [
        new ClsPluginTransactional({
          imports: [TestDbModule],
          adapter: new TransactionalAdapterDrizzleOrm({
            drizzleInstanceToken: DRIZZLE,
          }),
        }),
      ],
    });
    return { TestDbModule, TestConfigModule, cls };
  }

  async function boot() {
    const { TestDbModule, TestConfigModule, cls } = testModules();
    moduleRef = await Test.createTestingModule({
      imports: [
        TestConfigModule,
        TestDbModule,
        cls,
        RepositoriesModule,
        JobsModule,
      ],
    }).compile();
    await moduleRef.init();
  }

  async function shutdown() {
    await moduleRef?.close();
    moduleRef = undefined;
  }

  /** Settles leftovers so the startup sweep doesn't add traffic to assertions. */
  async function neutraliseLeftovers() {
    await testDb.pool.query(
      "UPDATE interview_questions SET status = 'failed' WHERE status IN ('pending', 'generating')",
    );
    await testDb.pool.query(
      "UPDATE application_scores SET status = 'failed' WHERE status IN ('pending', 'scoring')",
    );
    await testDb.pool.query(
      "UPDATE candidates SET parse_status = 'failed' WHERE parse_status IN ('pending', 'parsing')",
    );
  }

  function scoreResult(cvDocumentId: string): ScoreResult {
    return {
      overall: 50,
      rationale: 'Strong Kafka, no Kubernetes.',
      criteria: [
        {
          criterionId: 'c1',
          criterion: CRITERIA[0].text,
          importance: 'must',
          score: 85,
          reasoning: 'Kafka services.',
          quotes: [{ source: 'cv', text: KAFKA.text }],
          retrieved: null,
        },
        {
          criterionId: 'c2',
          criterion: CRITERIA[1].text,
          importance: 'must',
          score: 10,
          reasoning: 'Docker Compose only.',
          quotes: [{ source: 'cv', text: DOCKER.text }],
          retrieved: null,
        },
      ],
      cvDocumentId,
      model: 'test-model',
      mode: 'full_text',
      scoredAt: new Date().toISOString(),
    };
  }

  /** A parsed candidate with a current `scored` score; questions row optional. */
  async function seedScored(opts: { questions?: boolean } = {}) {
    const vacancy = await vacancies.create({
      recruiterId,
      title: 'Backend Engineer',
      requirements: `Kafka and Kubernetes ${randomUUID()}`,
      applyToken: randomUUID(),
    });
    const hash = vacancyCriteriaHash(vacancy.title, vacancy.requirements);
    await vacancies.saveCriteria(vacancy.id, CRITERIA, hash);
    const candidate = await candidates.create({
      name: 'Jane Doe',
      email: `${randomUUID()}@example.com`,
      githubUrl: null,
      portfolioUrl: null,
      skills: [],
      experience: '',
      projects: [],
      summary: '',
    });
    const content = Buffer.from(CV_TEXT);
    const cv = await cvDocuments.create({
      candidateId: candidate.id,
      filename: 'cv.pdf',
      sizeBytes: content.length,
      content,
      text: CV_TEXT,
    });
    await candidates.saveParsedProfile(candidate.id, cv.id, PROFILE, null);
    const application = await applications.create({
      vacancyId: vacancy.id,
      candidateId: candidate.id,
    });
    await scores.createPending(application.id);
    await scores.saveResult(application.id, {
      result: scoreResult(cv.id),
      cvDocumentId: cv.id,
      criteriaHash: hash,
      model: 'test-model',
      mode: 'full_text',
      inputTokens: 1,
      outputTokens: 1,
    });
    if (opts.questions ?? true) await questions.resetToPending(application.id);
    return {
      applicationId: application.id,
      vacancyId: vacancy.id,
      candidateId: candidate.id,
      cvId: cv.id,
      hash,
    };
  }

  async function rawQuestions(applicationId: string) {
    return (
      await testDb.pool.query(
        'SELECT * FROM interview_questions WHERE application_id = $1',
        [applicationId],
      )
    ).rows[0];
  }

  async function rawScoredAt(applicationId: string): Promise<Date> {
    return (
      await testDb.pool.query(
        'SELECT scored_at FROM application_scores WHERE application_id = $1',
        [applicationId],
      )
    ).rows[0].scored_at;
  }

  const readQuestions = (applicationId: string) =>
    questions.findApplicationQuestions(applicationId);

  function waitForQuestions(
    applicationId: string,
    status: ApplicationQuestions['status'],
  ) {
    return waitFor(
      () => readQuestions(applicationId),
      (q) => q.status === status,
    );
  }

  const enqueueQuestions = (applicationId: string) =>
    moduleRef!.get(JobsService).enqueueQuestions(applicationId);
  const handle = (applicationId: string) =>
    moduleRef!.get(GenerateQuestionsWorker).handle({ applicationId });

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const { TestDbModule, cls } = testModules();
    seedRef = await Test.createTestingModule({
      imports: [TestDbModule, cls, RepositoriesModule],
    }).compile();
    questions = seedRef.get(QUESTIONS_REPOSITORY);
    scores = seedRef.get(SCORES_REPOSITORY);
    applications = seedRef.get(APPLICATIONS_REPOSITORY);
    candidates = seedRef.get(CANDIDATES_REPOSITORY);
    cvDocuments = seedRef.get(CV_DOCUMENTS_REPOSITORY);
    vacancies = seedRef.get(VACANCIES_REPOSITORY);
    const recruiters: RecruitersRepository = seedRef.get(RECRUITERS_REPOSITORY);
    recruiterId = (
      await recruiters.create({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hashed-password',
      })
    ).id;

    server.listen({ onUnhandledFrame: 'error' });
    server.events.on('request:start', questionsCapture.listener);
  }, 120_000);

  afterEach(() => {
    server.resetHandlers();
    questionsCapture.bodies.length = 0;
  });

  afterAll(async () => {
    await shutdown();
    await seedRef.close();
    server.close();
    await teardownTestDatabase(testDb);
  });

  describe('worker', () => {
    beforeAll(async () => {
      await neutraliseLeftovers();
      await boot();
    }, 60_000);
    afterAll(shutdown);

    it('generates and saves a ready question set', async () => {
      server.use(openaiQuestionsHandler());
      const { applicationId, cvId, hash } = await seedScored();

      await enqueueQuestions(applicationId);
      const read = await waitForQuestions(applicationId, 'ready');

      expect(read).toMatchObject({
        status: 'ready',
        error: null,
        stale: false,
      });
      const set = read.result as QuestionSet;
      expect(set.cvDocumentId).toBe(cvId);
      expect(set.model).toBe('gpt-5.4-mini');
      expect(set.questions).toEqual([
        {
          text: `Tell me more about ${UNITS[0].id}.`,
          basis: 'fact',
          criterionId: 'c1',
          criterion: 'Event-driven backend',
          importance: 'must',
          purpose: 'Checks the stated experience.',
          quotes: [{ source: 'cv', text: UNITS[0].text }],
        },
        {
          text: 'How would you close this gap?',
          basis: 'gap',
          criterionId: 'c2',
          criterion: 'Kubernetes in production',
          importance: 'must',
          purpose: 'Checks the missing requirement.',
          quotes: [],
        },
      ]);
      const row = await rawQuestions(applicationId);
      expect(row).toMatchObject({
        cv_document_id: cvId,
        criteria_hash: hash,
        model: 'gpt-5.4-mini',
        input_tokens: 1200,
        output_tokens: 300,
        failure_details: null,
      });
      expect(row.score_scored_at).toEqual(await rawScoredAt(applicationId));
      expect(row.generated_at).toBeInstanceOf(Date);
      expect(questionsCapture.bodies).toHaveLength(1);
    });

    it('drops the job when the row is not pending or the application is gone', async () => {
      server.use(openaiQuestionsHandler());
      const ready = await seedScored();
      await handle(ready.applicationId);
      expect((await rawQuestions(ready.applicationId)).status).toBe('ready');
      questionsCapture.bodies.length = 0;
      const failed = await seedScored();
      await questions.markFailed(failed.applicationId, 'boom', null);
      const none = await seedScored({ questions: false });

      await handle(ready.applicationId);
      await handle(failed.applicationId);
      await handle(none.applicationId);
      await handle(randomUUID());

      expect(questionsCapture.bodies).toHaveLength(0);
      expect((await rawQuestions(failed.applicationId)).status).toBe('failed');
      expect(await rawQuestions(none.applicationId)).toBeUndefined();
    });

    it('fails with SCORE_NOT_READY_ERROR when the score is not scored or is stale', async () => {
      const pending = await seedScored();
      await scores.resetToPending(pending.applicationId);
      const stale = await seedScored();
      await vacancies.update(stale.vacancyId, { requirements: 'Changed' });

      await handle(pending.applicationId);
      await handle(stale.applicationId);

      expect(questionsCapture.bodies).toHaveLength(0);
      for (const { applicationId } of [pending, stale]) {
        expect(await readQuestions(applicationId)).toMatchObject({
          status: 'failed',
          error: SCORE_NOT_READY_ERROR,
        });
      }
    });

    it('fails with score-changed when the score is rescored mid-call', async () => {
      server.use(openaiQuestionsHandler());
      const { applicationId } = await seedScored();
      await handle(applicationId);
      const previous = (await readQuestions(applicationId)).result;
      await questions.resetToPending(applicationId);
      server.use(
        openaiQuestionsHandler(undefined, {
          before: async () => {
            await testDb.pool.query(
              "UPDATE application_scores SET scored_at = scored_at + interval '1 minute' WHERE application_id = $1",
              [applicationId],
            );
          },
        }),
      );

      await handle(applicationId);

      expect(await readQuestions(applicationId)).toEqual({
        status: 'failed',
        error: SCORE_CHANGED_ERROR,
        stale: true,
        result: previous,
      });
    });

    it('records failure details on a grounding failure', async () => {
      server.use(openaiQuestionsHandler(fabricatedQuestionsResponse));
      const { applicationId } = await seedScored();

      await handle(applicationId);

      expect(questionsCapture.bodies).toHaveLength(2);
      const row = await rawQuestions(applicationId);
      expect(row.status).toBe('failed');
      expect(row.error).toBe(GROUNDING_ERROR);
      expect(row.failure_details).toEqual([
        'Question 1 cites unknown evidence id "S999"',
      ]);
      expect(row.result).toBeNull();
    });

    it('records the generic message on an OpenAI error, without failure details', async () => {
      server.use(openaiErrorHandler(500, 'interview_questions'));
      const { applicationId } = await seedScored();

      await handle(applicationId);

      const row = await rawQuestions(applicationId);
      expect(row).toMatchObject({
        status: 'failed',
        error: GENERIC_QUESTIONS_ERROR,
        failure_details: null,
      });
    }, 30_000);
  });

  describe('startup sweep', () => {
    afterEach(shutdown);

    it('startup sweep re-enqueues pending and generating rows', async () => {
      await neutraliseLeftovers();
      server.use(openaiQuestionsHandler());
      const pending = await seedScored();
      const generating = await seedScored();
      await questions.markGenerating(generating.applicationId);
      const failed = await seedScored();
      await questions.markFailed(failed.applicationId, 'x', null);

      await boot();

      await waitForQuestions(pending.applicationId, 'ready');
      await waitForQuestions(generating.applicationId, 'ready');
      expect(questionsCapture.bodies).toHaveLength(2);
      expect((await readQuestions(failed.applicationId)).status).toBe('failed');
    });
  });
});
