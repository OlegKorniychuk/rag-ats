import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test, type TestingModule } from '@nestjs/testing';
import type { ApplicationScore, VacancyCriterion } from '@rag-ats/shared';
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
import type { GithubSnapshot } from '../../src/github/github-snapshot.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import { ScoreApplicationWorker } from '../../src/jobs/score-application.worker.js';
import { normaliseText } from '../../src/llm/cv-profile-parser.js';
import { normaliseForMatch } from '../../src/scoring/verify-quotes.js';
import { vacancyCriteriaHash } from '../../src/scoring/criteria-hash.js';
import {
  captureOpenaiRequests,
  criterionIdsFromRequest,
  fabricatedScoreResponse,
  openaiCriteriaHandler,
  openaiErrorHandler,
  openaiProfileHandler,
  openaiScoreHandler,
  scoreFromRequest,
  type MockCriterion,
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

const CV_TEXT =
  'Jane Doe is a backend engineer with five years of TypeScript and Node.js experience.';

const MOCK_CRITERIA: MockCriterion[] = [
  { text: 'Experience with TypeScript', importance: 'must' },
  { text: 'Experience building REST APIs', importance: 'must' },
  { text: 'Knowledge of Docker', importance: 'nice' },
];
const STORED_CRITERIA: VacancyCriterion[] = MOCK_CRITERIA.map((c, i) => ({
  id: `c${i + 1}`,
  ...c,
}));

const CRITERIA_FAILURE = 'Could not extract criteria from the vacancy';
const GROUNDING_FAILURE = 'Could not ground the score in the CV';

// OpenAI is the only HTTP dependency (GitHub is never called: seeded
// candidates have no GitHub URL). Any unmocked request fails the test.
const server = setupServer();
const scoreCapture = captureOpenaiRequests('application_score');
const criteriaCapture = captureOpenaiRequests('vacancy_criteria');
const profileCapture = captureOpenaiRequests('cv_profile');

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A gate that holds a mocked request in flight until `release()`. */
function gate() {
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const startedPromise = new Promise<void>((resolve) => (started = resolve));
  return {
    release,
    started: startedPromise,
    before: async () => {
      started();
      await released;
    },
  };
}

describe('Score jobs (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule | undefined;
  let seedRef: TestingModule;
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

  /** Boots the job runtime (workers + sweep). */
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
      "UPDATE application_scores SET status = 'failed' WHERE status IN ('pending', 'scoring')",
    );
    await testDb.pool.query(
      "UPDATE candidates SET parse_status = 'failed' WHERE parse_status IN ('pending', 'parsing')",
    );
  }

  async function seedVacancy(opts: { criteria?: boolean } = {}) {
    const vacancy = await vacancies.create({
      recruiterId,
      title: 'Backend Engineer',
      requirements: `Node.js and TypeScript ${randomUUID()}`,
      applyToken: randomUUID(),
    });
    if (opts.criteria) {
      await vacancies.saveCriteria(
        vacancy.id,
        STORED_CRITERIA,
        vacancyCriteriaHash(vacancy.title, vacancy.requirements),
      );
    }
    return vacancy;
  }

  async function seedCandidate(opts: { parsed?: boolean; text?: string } = {}) {
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
    const cvId = await addCv(candidate.id, opts.text ?? CV_TEXT, 0);
    if (opts.parsed ?? true) {
      await candidates.saveParsedProfile(candidate.id, cvId, PROFILE, null);
    }
    return { candidateId: candidate.id, cvId };
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

  async function seedApplication(
    opts: {
      vacancyId?: string;
      criteria?: boolean;
      parsed?: boolean;
      cvText?: string;
    } = {},
  ) {
    const vacancyId =
      opts.vacancyId ??
      (await seedVacancy({ criteria: opts.criteria ?? true })).id;
    const { candidateId, cvId } = await seedCandidate({
      parsed: opts.parsed,
      text: opts.cvText,
    });
    const application = await applications.create({ vacancyId, candidateId });
    await scores.createPending(application.id);
    return { applicationId: application.id, vacancyId, candidateId, cvId };
  }

  async function rawScore(applicationId: string) {
    return (
      await testDb.pool.query(
        'SELECT * FROM application_scores WHERE application_id = $1',
        [applicationId],
      )
    ).rows[0];
  }

  const readScore = async (applicationId: string) =>
    (await scores.findApplicationScore(applicationId))!;

  function waitForScore(
    applicationId: string,
    status: ApplicationScore['status'],
  ) {
    return waitFor(
      () => readScore(applicationId),
      (score) => score.status === status,
    );
  }

  const enqueueScore = (applicationId: string) =>
    moduleRef!.get(JobsService).enqueueScore(applicationId);

  /** Default OpenAI answers for a flow that needs criteria and a valid score. */
  const useValidScoring = () =>
    server.use(
      openaiCriteriaHandler(MOCK_CRITERIA),
      openaiScoreHandler((body) => scoreFromRequest(body)),
    );

  beforeAll(async () => {
    testDb = await createTestDatabase();
    const { TestDbModule, cls } = testModules();
    seedRef = await Test.createTestingModule({
      imports: [TestDbModule, cls, RepositoriesModule],
    }).compile();
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
    server.events.on('request:start', scoreCapture.listener);
    server.events.on('request:start', criteriaCapture.listener);
    server.events.on('request:start', profileCapture.listener);
  }, 120_000);

  afterEach(() => {
    server.resetHandlers();
    scoreCapture.bodies.length = 0;
    criteriaCapture.bodies.length = 0;
    profileCapture.bodies.length = 0;
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

    it('scores a parsed application: verified quotes, computed overall, bookkeeping columns', async () => {
      useValidScoring();
      const { applicationId, cvId, vacancyId } = await seedApplication();

      await enqueueScore(applicationId);
      const score = await waitForScore(applicationId, 'scored');

      expect(score).toMatchObject({
        status: 'scored',
        error: null,
        stale: false,
        waitingForParse: false,
      });
      const result = score.result!;
      // Every criterion scores 80, so the weighted mean is 80.
      expect(result.overall).toBe(80);
      expect(result.cvDocumentId).toBe(cvId);
      expect(result.mode).toBe('full_text');
      expect(result.criteria.map((c) => c.criterionId)).toEqual([
        'c1',
        'c2',
        'c3',
      ]);
      const cv = normaliseForMatch(normaliseText(CV_TEXT));
      for (const criterion of result.criteria) {
        expect(criterion.quotes.length).toBeGreaterThan(0);
        for (const quote of criterion.quotes) {
          expect(quote.source).toBe('cv');
          expect(cv).toContain(normaliseForMatch(quote.text));
        }
      }
      expect(Date.parse(result.scoredAt)).not.toBeNaN();

      const vacancy = await vacancies.findCriteriaState(vacancyId);
      const row = await rawScore(applicationId);
      expect(row).toMatchObject({
        status: 'scored',
        cv_document_id: cvId,
        criteria_hash: vacancy!.criteriaHash,
        model: 'gpt-5.4-mini',
        mode: 'full_text',
        input_tokens: 1200,
        output_tokens: 300,
        error: null,
      });
      expect(row.scored_at).not.toBeNull();
      expect(result.model).toBe('gpt-5.4-mini');
      expect(scoreCapture.bodies).toHaveLength(1);
    });

    it('runs outside a request: handle() provides its own CLS context', async () => {
      useValidScoring();
      const { applicationId } = await seedApplication();

      await moduleRef!.get(ScoreApplicationWorker).handle({ applicationId });

      expect((await readScore(applicationId)).status).toBe('scored');
    });

    it('does not score again for a duplicate job', async () => {
      useValidScoring();
      const { applicationId } = await seedApplication();
      const worker = moduleRef!.get(ScoreApplicationWorker);

      await worker.handle({ applicationId });
      await worker.handle({ applicationId });

      expect(scoreCapture.bodies).toHaveLength(1);
    });

    it('feeds the GitHub snapshot to the scorer when it is ok', async () => {
      useValidScoring();
      const { applicationId, candidateId, cvId } = await seedApplication();
      const snapshot: GithubSnapshot = {
        username: 'janedoe',
        profileUrl: 'https://github.com/janedoe',
        status: 'ok',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        bio: 'Backend engineer.',
        repos: [],
        languages: [],
      };
      await candidates.saveParsedProfile(candidateId, cvId, PROFILE, snapshot);

      await moduleRef!.get(ScoreApplicationWorker).handle({ applicationId });

      expect((await readScore(applicationId)).status).toBe('scored');
      const user = scoreCapture.bodies[0].input.find(
        (m: any) => m.role === 'user',
      );
      expect(user.content).toContain('<github>');
      expect(user.content).toContain('Backend engineer.');
    });

    it('extracts missing criteria once for two applications of a vacancy, then scores both', async () => {
      useValidScoring();
      const vacancy = await seedVacancy();
      const first = await seedApplication({ vacancyId: vacancy.id });
      const second = await seedApplication({ vacancyId: vacancy.id });

      await Promise.all([
        enqueueScore(first.applicationId),
        enqueueScore(second.applicationId),
      ]);
      await waitForScore(first.applicationId, 'scored');
      await waitForScore(second.applicationId, 'scored');

      // Singleton: concurrent score jobs share one extraction (no duplicate LLM call).
      expect(criteriaCapture.bodies).toHaveLength(1);
      expect(scoreCapture.bodies).toHaveLength(2);
      const state = await vacancies.findCriteriaState(vacancy.id);
      expect(state?.criteriaHash).toBe(
        vacancyCriteriaHash(vacancy.title, vacancy.requirements),
      );
      expect(
        (await readScore(first.applicationId)).result?.criteria,
      ).toHaveLength(3);
    });

    it('retries a fabricated quote with feedback, then stores the valid score', async () => {
      let call = 0;
      server.use(
        openaiScoreHandler((body) =>
          call++ === 0
            ? fabricatedScoreResponse(criterionIdsFromRequest(body))
            : scoreFromRequest(body),
        ),
      );
      const { applicationId } = await seedApplication();

      await enqueueScore(applicationId);
      const score = await waitForScore(applicationId, 'scored');

      expect(scoreCapture.bodies).toHaveLength(2);
      expect(score.result?.overall).toBe(80);
      // Tokens of both attempts are summed.
      expect((await rawScore(applicationId)).input_tokens).toBe(2400);
    });

    it('fails with a grounding message when quotes are fabricated twice', async () => {
      server.use(
        openaiScoreHandler((body) =>
          fabricatedScoreResponse(criterionIdsFromRequest(body)),
        ),
      );
      const { applicationId } = await seedApplication();

      await enqueueScore(applicationId);
      const score = await waitForScore(applicationId, 'failed');

      expect(score.error).toBe(GROUNDING_FAILURE);
      expect(score.result).toBeNull();
      expect(scoreCapture.bodies).toHaveLength(2);
    });

    it('records a generic message on an OpenAI error', async () => {
      server.use(openaiErrorHandler(500, 'application_score'));
      const { applicationId } = await seedApplication();

      await enqueueScore(applicationId);
      const score = await waitForScore(applicationId, 'failed');

      expect(score.error).toBe('Could not score the application');
    });

    it('fails the vacancy’s pending scores when criteria extraction fails', async () => {
      server.use(openaiErrorHandler(500, 'vacancy_criteria'));
      const vacancy = await seedVacancy();
      const first = await seedApplication({ vacancyId: vacancy.id });
      const second = await seedApplication({ vacancyId: vacancy.id });

      await enqueueScore(first.applicationId);
      await enqueueScore(second.applicationId);

      for (const { applicationId } of [first, second]) {
        const score = await waitForScore(applicationId, 'failed');
        expect(score.error).toBe(CRITERIA_FAILURE);
      }
      expect(scoreCapture.bodies).toHaveLength(0);
    });

    it('keeps the score pending (no LLM call) while the candidate is not parsed, then scores once the parse completes', async () => {
      server.use(
        openaiProfileHandler(PROFILE),
        openaiScoreHandler((body) => scoreFromRequest(body)),
      );
      const { applicationId, candidateId, cvId } = await seedApplication({
        parsed: false,
      });

      await enqueueScore(applicationId);
      await sleep(2_000);

      let score = await readScore(applicationId);
      expect(score).toMatchObject({ status: 'pending', waitingForParse: true });
      expect(scoreCapture.bodies).toHaveLength(0);

      await moduleRef!.get(JobsService).enqueueParse(candidateId, cvId);
      score = await waitForScore(applicationId, 'scored');

      expect(profileCapture.bodies).toHaveLength(1);
      expect(score).toMatchObject({ waitingForParse: false, stale: false });
      expect(scoreCapture.bodies).toHaveLength(1);
    });

    it('rescores against a newer CV: the old result is kept (stale) until the new one lands', async () => {
      const { applicationId, candidateId, cvId } = await seedApplication();
      server.use(
        openaiProfileHandler(PROFILE),
        openaiScoreHandler((body) => scoreFromRequest(body)),
      );
      await enqueueScore(applicationId);
      const first = await waitForScore(applicationId, 'scored');
      expect(first.result?.cvDocumentId).toBe(cvId);

      // The second score call is held in flight so the intermediate state is observable.
      const held = gate();
      server.use(
        openaiScoreHandler((body) => scoreFromRequest(body), {
          before: held.before,
        }),
      );
      const newCvText =
        'Jane Doe now leads a platform team and writes Go and Rust services daily.';
      const newCvId = await addCv(candidateId, newCvText, 5);
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'pending' WHERE id = $1",
        [candidateId],
      );
      await moduleRef!.get(JobsService).enqueueParse(candidateId, newCvId);

      await held.started;
      const mid = await readScore(applicationId);
      expect(mid.status).toBe('scoring');
      expect(mid.stale).toBe(true);
      expect(mid.result?.cvDocumentId).toBe(cvId);
      held.release();

      const last = await waitForScore(applicationId, 'scored');
      expect(last).toMatchObject({ stale: false, waitingForParse: false });
      expect(last.result?.cvDocumentId).toBe(newCvId);
      const quote = last.result!.criteria[0].quotes[0].text;
      expect(normaliseForMatch(normaliseText(newCvText))).toContain(
        normaliseForMatch(quote),
      );
      expect((await rawScore(applicationId)).cv_document_id).toBe(newCvId);
    });

    it('resets every score of the candidate to pending (result kept, stale) when a newer CV is parsed', async () => {
      const first = await seedApplication();
      const secondApplication = await applications.create({
        vacancyId: (await seedVacancy({ criteria: true })).id,
        candidateId: first.candidateId,
      });
      await scores.createPending(secondApplication.id);
      server.use(
        openaiProfileHandler(PROFILE),
        openaiScoreHandler((body) => scoreFromRequest(body)),
      );
      await enqueueScore(first.applicationId);
      await enqueueScore(secondApplication.id);
      await waitForScore(first.applicationId, 'scored');
      await waitForScore(secondApplication.id, 'scored');

      const held = gate();
      server.use(
        openaiScoreHandler((body) => scoreFromRequest(body), {
          before: held.before,
        }),
      );
      const newCvId = await addCv(
        first.candidateId,
        'A brand new CV text here',
        7,
      );
      // Like the apply/reparse paths, a new CV puts the candidate back to pending.
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'pending' WHERE id = $1",
        [first.candidateId],
      );
      await moduleRef!
        .get(JobsService)
        .enqueueParse(first.candidateId, newCvId);
      await held.started;

      for (const applicationId of [first.applicationId, secondApplication.id]) {
        const score = await readScore(applicationId);
        expect(score.result).not.toBeNull();
        expect(score.stale).toBe(true);
        expect(['pending', 'scoring']).toContain(score.status);
      }
      held.release();
      await waitForScore(first.applicationId, 'scored');
      await waitForScore(secondApplication.id, 'scored');
    });

    it('drops the result when the vacancy requirements change mid-call, then rescores against fresh criteria', async () => {
      const { applicationId, vacancyId } = await seedApplication();
      let call = 0;
      server.use(
        openaiCriteriaHandler(MOCK_CRITERIA),
        openaiScoreHandler((body) => scoreFromRequest(body), {
          before: async () => {
            if (call++ === 0) {
              await vacancies.update(vacancyId, {
                requirements: 'Completely different requirements',
              });
            }
          },
        }),
      );

      await enqueueScore(applicationId);
      const score = await waitFor(
        () => rawScore(applicationId),
        (row) => row.status === 'scored',
      );

      const vacancy = await vacancies.findCriteriaState(vacancyId);
      const currentHash = vacancyCriteriaHash(
        vacancy!.title,
        vacancy!.requirements,
      );
      // The first result (old hash) was not saved as current: the stored score
      // was computed from the re-extracted criteria of the edited vacancy.
      expect(score.criteria_hash).toBe(currentHash);
      expect(criteriaCapture.bodies).toHaveLength(1);
      expect(scoreCapture.bodies).toHaveLength(2);
      expect((await readScore(applicationId)).stale).toBe(false);
    });
  });

  describe('startup sweep', () => {
    afterEach(shutdown);

    it('enqueues pending/scoring scores of parsed candidates, not of unparsed ones', async () => {
      await neutraliseLeftovers();
      const pending = await seedApplication();
      const scoring = await seedApplication();
      await scores.markScoring(scoring.applicationId);
      const done = await seedApplication();
      await scores.markFailed(done.applicationId, 'x');
      const unparsed = await seedApplication({ parsed: false });
      useValidScoring();

      await boot();

      await waitForScore(pending.applicationId, 'scored');
      await waitForScore(scoring.applicationId, 'scored');
      expect(scoreCapture.bodies).toHaveLength(2);
      expect((await readScore(done.applicationId)).status).toBe('failed');
      expect(await readScore(unparsed.applicationId)).toMatchObject({
        status: 'pending',
        waitingForParse: true,
      });
    });
  });
});
