import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import type { QuestionSet, ScoreResult } from '@rag-ats/shared';
import { eq } from 'drizzle-orm';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  applicationScores,
  applications as applicationsTable,
  interviewQuestions,
} from '../../src/db/schema.js';
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
  QUESTIONS_REPOSITORY,
  type QuestionsRepository,
  type SavedQuestions,
} from '../../src/db/repositories/questions.repository.js';
import {
  SCORES_REPOSITORY,
  type ScoresRepository,
} from '../../src/db/repositories/scores.repository.js';
import {
  VACANCIES_REPOSITORY,
  type NewVacancy,
  type VacanciesRepository,
} from '../../src/db/repositories/vacancies.repository.js';
import { vacancyCriteriaHash } from '../../src/scoring/criteria-hash.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

const profile = {
  skills: ['TypeScript'],
  experience: '5 years',
  projects: ['RAG-ATS'],
  summary: 'Backend engineer.',
};

const scoreScoredAt = new Date('2026-11-21T10:00:00.000Z');

function makeScoreResult(cvDocumentId: string): ScoreResult {
  return {
    overall: 40,
    rationale: 'Partial fit.',
    criteria: [
      {
        criterionId: 'c1',
        criterion: 'Node.js',
        importance: 'must',
        score: 40,
        reasoning: 'Some Node.js.',
        quotes: [{ source: 'cv', text: 'Built Node.js services' }],
        retrieved: null,
      },
    ],
    cvDocumentId,
    model: 'gpt-test',
    mode: 'full_text',
    scoredAt: '2026-11-21T10:00:00.000Z',
  };
}

function makeSavedScore(cvDocumentId: string, criteriaHash = 'hash-1') {
  return {
    result: makeScoreResult(cvDocumentId),
    cvDocumentId,
    criteriaHash,
    model: 'gpt-test',
    mode: 'full_text',
    inputTokens: 1,
    outputTokens: 1,
  };
}

function makeQuestionSet(cvDocumentId: string): QuestionSet {
  return {
    questions: [
      {
        text: 'Which Node.js services did you build?',
        basis: 'fact',
        criterionId: 'c1',
        criterion: 'Node.js',
        importance: 'must',
        purpose: 'Checks Node.js depth.',
        quotes: [{ source: 'cv', text: 'Built Node.js services' }],
      },
    ],
    cvDocumentId,
    model: 'gpt-test',
    generatedAt: '2026-11-21T10:05:00.000Z',
  };
}

function makeSavedQuestions(cvDocumentId: string): SavedQuestions {
  return {
    result: makeQuestionSet(cvDocumentId),
    cvDocumentId,
    criteriaHash: 'hash-1',
    scoreScoredAt,
    model: 'gpt-test',
    inputTokens: 900,
    outputTokens: 400,
  };
}

describe('QuestionsRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let recruiterId: string;
  let questions: QuestionsRepository;
  let scores: ScoresRepository;
  let applications: ApplicationsRepository;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;
  let vacancies: VacanciesRepository;

  beforeAll(async () => {
    testDb = await createTestDatabase();

    @Global()
    @Module({
      providers: [{ provide: DRIZZLE, useValue: testDb.db }],
      exports: [DRIZZLE],
    })
    class TestDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        TestDbModule,
        ClsModule.forRoot({
          global: true,
          middleware: { mount: true },
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
      ],
    }).compile();

    questions = moduleRef.get(QUESTIONS_REPOSITORY);
    scores = moduleRef.get(SCORES_REPOSITORY);
    applications = moduleRef.get(APPLICATIONS_REPOSITORY);
    candidates = moduleRef.get(CANDIDATES_REPOSITORY);
    cvDocuments = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
    vacancies = moduleRef.get(VACANCIES_REPOSITORY);
    const recruiters: RecruitersRepository = moduleRef.get(
      RECRUITERS_REPOSITORY,
    );
    recruiterId = (
      await recruiters.create({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hashed-password',
      })
    ).id;
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  async function seedVacancy(overrides: Partial<NewVacancy> = {}) {
    return vacancies.create({
      recruiterId,
      title: 'Backend Engineer',
      requirements: 'Node.js, PostgreSQL',
      applyToken: randomUUID(),
      ...overrides,
    });
  }

  async function seedCandidate(parsed = false) {
    const candidate = await candidates.create({
      name: 'Jane Doe',
      email: `${randomUUID()}@example.com`,
      skills: [],
      experience: '',
      projects: [],
      summary: '',
    });
    const cv = await cvDocuments.create({
      candidateId: candidate.id,
      filename: 'cv.pdf',
      sizeBytes: 3,
      content: Buffer.from('pdf'),
      text: 'cv text',
    });
    if (parsed) {
      await candidates.saveParsedProfile(candidate.id, cv.id, profile, null);
    }
    return { candidateId: candidate.id, cvId: cv.id };
  }

  async function seedApplication(opts: {
    vacancyId?: string;
    candidateId?: string;
    parsed?: boolean;
    withScore?: boolean;
  }) {
    const vacancyId = opts.vacancyId ?? (await seedVacancy()).id;
    const seeded = opts.candidateId
      ? { candidateId: opts.candidateId, cvId: '' }
      : await seedCandidate(opts.parsed ?? false);
    const application = await applications.create({
      vacancyId,
      candidateId: seeded.candidateId,
    });
    if (opts.withScore !== false) await scores.createPending(application.id);
    return { applicationId: application.id, vacancyId, ...seeded };
  }

  async function rawQuestions(applicationId: string) {
    const [row] = await testDb.db
      .select()
      .from(interviewQuestions)
      .where(eq(interviewQuestions.applicationId, applicationId));
    return row;
  }

  it('resetToPending creates a pending row, then keeps the result on a second reset', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });

    await questions.resetToPending(applicationId);
    expect((await rawQuestions(applicationId)).status).toBe('pending');

    await questions.saveResult(applicationId, makeSavedQuestions(cvId));
    await questions.resetToPending(applicationId);

    const row = await rawQuestions(applicationId);
    expect(row.status).toBe('pending');
    expect(row.result).toEqual(makeQuestionSet(cvId));
  });

  it('resetToPending clears the error of a failed row', async () => {
    const { applicationId } = await seedApplication({ parsed: true });
    await questions.resetToPending(applicationId);
    await questions.markFailed(applicationId, 'Could not generate questions', [
      'detail',
    ]);

    await questions.resetToPending(applicationId);

    expect((await rawQuestions(applicationId)).error).toBeNull();
  });

  describe('markGenerating', () => {
    it('moves pending and generating rows to generating', async () => {
      const { applicationId } = await seedApplication({ parsed: true });
      await questions.resetToPending(applicationId);

      expect(await questions.markGenerating(applicationId)).toBe(true);
      expect(await questions.markGenerating(applicationId)).toBe(true);

      expect((await rawQuestions(applicationId)).status).toBe('generating');
    });

    it('returns false for ready, failed or missing rows', async () => {
      const ready = await seedApplication({ parsed: true });
      await questions.resetToPending(ready.applicationId);
      await questions.saveResult(
        ready.applicationId,
        makeSavedQuestions(ready.cvId),
      );
      const failed = await seedApplication({ parsed: true });
      await questions.resetToPending(failed.applicationId);
      await questions.markFailed(failed.applicationId, 'boom', null);
      const missing = await seedApplication({ parsed: true });

      expect(await questions.markGenerating(ready.applicationId)).toBe(false);
      expect(await questions.markGenerating(failed.applicationId)).toBe(false);
      expect(await questions.markGenerating(missing.applicationId)).toBe(false);
      expect((await rawQuestions(ready.applicationId)).status).toBe('ready');
    });
  });

  it('saveResult sets ready and clears error and failure details', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });
    await questions.resetToPending(applicationId);
    await questions.markFailed(applicationId, 'boom', ['grounding problem']);

    await questions.saveResult(applicationId, makeSavedQuestions(cvId));

    const row = await rawQuestions(applicationId);
    expect(row).toMatchObject({
      status: 'ready',
      error: null,
      failureDetails: null,
      result: makeQuestionSet(cvId),
      cvDocumentId: cvId,
      criteriaHash: 'hash-1',
      scoreScoredAt: scoreScoredAt,
      model: 'gpt-test',
      inputTokens: 900,
      outputTokens: 400,
    });
    expect(row.generatedAt).toBeInstanceOf(Date);
  });

  it('markFailed stores the error and details and keeps the result', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });
    await questions.resetToPending(applicationId);
    await questions.saveResult(applicationId, makeSavedQuestions(cvId));

    await questions.markFailed(applicationId, 'boom', ['detail']);

    const row = await rawQuestions(applicationId);
    expect(row).toMatchObject({
      status: 'failed',
      error: 'boom',
      failureDetails: ['detail'],
      result: makeQuestionSet(cvId),
    });
  });

  it('findState joins the score, vacancy and candidate', async () => {
    const vacancy = await seedVacancy({
      title: 'Platform',
      requirements: 'Go',
    });
    const { applicationId, cvId, candidateId } = await seedApplication({
      vacancyId: vacancy.id,
      parsed: true,
    });
    await scores.saveResult(applicationId, makeSavedScore(cvId));

    const before = await questions.findState(applicationId);
    expect(before?.status).toBeNull();

    await questions.resetToPending(applicationId);
    const state = await questions.findState(applicationId);

    const [scoreRow] = await testDb.db
      .select()
      .from(applicationScores)
      .where(eq(applicationScores.applicationId, applicationId));
    expect(state).toEqual({
      applicationId,
      status: 'pending',
      vacancyTitle: 'Platform',
      vacancyRequirements: 'Go',
      candidateId,
      candidateParsedCvDocumentId: cvId,
      vacancyCriteriaHash: vacancyCriteriaHash('Platform', 'Go'),
      score: {
        status: 'scored',
        result: makeScoreResult(cvId),
        cvDocumentId: cvId,
        criteriaHash: 'hash-1',
        scoredAt: scoreRow.scoredAt,
      },
    });
    expect(state?.score?.scoredAt).toBeInstanceOf(Date);
  });

  it('findState returns null for a missing application and a null score without a score row', async () => {
    expect(await questions.findState(randomUUID())).toBeNull();
    const { applicationId } = await seedApplication({
      parsed: true,
      withScore: false,
    });

    expect((await questions.findState(applicationId))?.score).toBeNull();
  });

  it('findApplicationQuestions derives stale from the current score', async () => {
    const vacancy = await seedVacancy();
    const { applicationId, cvId } = await seedApplication({
      vacancyId: vacancy.id,
      parsed: true,
    });
    const hash = vacancyCriteriaHash(vacancy.title, vacancy.requirements);
    await scores.saveResult(applicationId, makeSavedScore(cvId, hash));
    expect(await questions.findApplicationQuestions(applicationId)).toEqual({
      status: null,
      error: null,
      stale: false,
      result: null,
    });
    const [scoreRow] = await testDb.db
      .select()
      .from(applicationScores)
      .where(eq(applicationScores.applicationId, applicationId));
    await questions.resetToPending(applicationId);
    await questions.saveResult(applicationId, {
      ...makeSavedQuestions(cvId),
      criteriaHash: hash,
      scoreScoredAt: scoreRow.scoredAt!,
    });

    expect(await questions.findApplicationQuestions(applicationId)).toEqual({
      status: 'ready',
      error: null,
      stale: false,
      result: makeQuestionSet(cvId),
    });

    await scores.saveResult(applicationId, makeSavedScore(cvId, hash));
    expect(
      (await questions.findApplicationQuestions(applicationId)).stale,
    ).toBe(true);
  });

  it('findBacklog returns pending and generating ids only', async () => {
    const pending = await seedApplication({ parsed: true });
    await questions.resetToPending(pending.applicationId);
    const generating = await seedApplication({ parsed: true });
    await questions.resetToPending(generating.applicationId);
    await questions.markGenerating(generating.applicationId);
    const ready = await seedApplication({ parsed: true });
    await questions.resetToPending(ready.applicationId);
    await questions.saveResult(
      ready.applicationId,
      makeSavedQuestions(ready.cvId),
    );
    const failed = await seedApplication({ parsed: true });
    await questions.resetToPending(failed.applicationId);
    await questions.markFailed(failed.applicationId, 'boom', null);

    const backlog = await questions.findBacklog();

    expect(backlog).toEqual(
      expect.arrayContaining([pending.applicationId, generating.applicationId]),
    );
    expect(backlog).not.toContain(ready.applicationId);
    expect(backlog).not.toContain(failed.applicationId);
  });

  it('rows are deleted with the application', async () => {
    const { applicationId } = await seedApplication({ parsed: true });
    await questions.resetToPending(applicationId);

    await testDb.db
      .delete(applicationsTable)
      .where(eq(applicationsTable.id, applicationId));

    expect(await rawQuestions(applicationId)).toBeUndefined();
  });
});
