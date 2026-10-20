import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import type { ScoreResult } from '@rag-ats/shared';
import { eq } from 'drizzle-orm';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import { applicationScores } from '../../src/db/schema.js';
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
  type SavedScore,
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

function makeResult(cvDocumentId: string, overall = 80): ScoreResult {
  return {
    overall,
    rationale: 'Good fit.',
    criteria: [
      {
        criterionId: 'c1',
        criterion: 'Node.js',
        importance: 'must',
        score: overall,
        reasoning: 'Uses Node.js.',
        quotes: [{ source: 'cv', text: 'Built Node.js services' }],
      },
    ],
    cvDocumentId,
    model: 'gpt-test',
    mode: 'full_text',
    scoredAt: '2026-01-15T09:30:00.000Z',
  };
}

function makeSaved(cvDocumentId: string, overall = 80): SavedScore {
  return {
    result: makeResult(cvDocumentId, overall),
    cvDocumentId,
    criteriaHash: 'hash-1',
    model: 'gpt-test',
    mode: 'full_text',
    inputTokens: 1200,
    outputTokens: 300,
  };
}

describe('ScoresRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let recruiterId: string;
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

  async function rawScore(applicationId: string) {
    const [row] = await testDb.db
      .select()
      .from(applicationScores)
      .where(eq(applicationScores.applicationId, applicationId));
    return row;
  }

  it('createPending inserts a pending row and is idempotent', async () => {
    const { applicationId } = await seedApplication({ withScore: false });

    await scores.createPending(applicationId);
    await scores.markScoring(applicationId);
    await scores.createPending(applicationId);

    const row = await rawScore(applicationId);
    expect(row.status).toBe('scoring');
    expect(row.result).toBeNull();
  });

  describe('markScoring', () => {
    it.each(['pending', 'failed', 'scoring'] as const)(
      'moves %s to scoring and clears the error',
      async (from) => {
        const { applicationId } = await seedApplication({});
        if (from === 'failed') await scores.markFailed(applicationId, 'boom');
        if (from === 'scoring') await scores.markScoring(applicationId);

        expect(await scores.markScoring(applicationId)).toBe(true);

        const row = await rawScore(applicationId);
        expect(row.status).toBe('scoring');
        expect(row.error).toBeNull();
      },
    );

    it('returns false and changes nothing when already scored', async () => {
      const { applicationId, cvId } = await seedApplication({ parsed: true });
      await scores.saveResult(applicationId, makeSaved(cvId));

      expect(await scores.markScoring(applicationId)).toBe(false);

      expect((await rawScore(applicationId)).status).toBe('scored');
    });

    it('returns false for an application without a score row', async () => {
      const { applicationId } = await seedApplication({ withScore: false });
      expect(await scores.markScoring(applicationId)).toBe(false);
    });
  });

  it('saveResult stores the result and bookkeeping and marks scored', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });
    await scores.markFailed(applicationId, 'earlier failure');

    await scores.saveResult(applicationId, makeSaved(cvId, 72));

    const row = await rawScore(applicationId);
    expect(row.status).toBe('scored');
    expect(row.error).toBeNull();
    expect(row.result).toEqual(makeResult(cvId, 72));
    expect(row.cvDocumentId).toBe(cvId);
    expect(row.criteriaHash).toBe('hash-1');
    expect(row.model).toBe('gpt-test');
    expect(row.mode).toBe('full_text');
    expect(row.inputTokens).toBe(1200);
    expect(row.outputTokens).toBe(300);
    expect(row.scoredAt).toBeInstanceOf(Date);
  });

  it('markFailed records the error and keeps a previous result', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });
    await scores.saveResult(applicationId, makeSaved(cvId));

    await scores.markFailed(applicationId, 'Could not ground the score');

    const row = await rawScore(applicationId);
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Could not ground the score');
    expect(row.result).not.toBeNull();
  });

  it('resetToPending clears the error and keeps the result', async () => {
    const { applicationId, cvId } = await seedApplication({ parsed: true });
    await scores.saveResult(applicationId, makeSaved(cvId));
    await scores.markFailed(applicationId, 'boom');

    await scores.resetToPending(applicationId);

    const row = await rawScore(applicationId);
    expect(row.status).toBe('pending');
    expect(row.error).toBeNull();
    expect(row.result).toEqual(makeResult(cvId));
  });

  it("resetPendingForCandidate resets all of the candidate's scores and keeps results", async () => {
    const first = await seedApplication({ parsed: true });
    const second = await seedApplication({ candidateId: first.candidateId });
    const other = await seedApplication({ parsed: true });
    await scores.saveResult(first.applicationId, makeSaved(first.cvId));
    await scores.saveResult(second.applicationId, makeSaved(first.cvId));
    await scores.saveResult(other.applicationId, makeSaved(other.cvId));

    const ids = await scores.resetPendingForCandidate(first.candidateId);

    expect(ids.sort()).toEqual(
      [first.applicationId, second.applicationId].sort(),
    );
    for (const id of ids) {
      const row = await rawScore(id);
      expect(row.status).toBe('pending');
      expect(row.result).not.toBeNull();
    }
    expect((await rawScore(other.applicationId)).status).toBe('scored');
  });

  it('resetPendingForCandidate returns an empty list for a candidate with no applications', async () => {
    const { candidateId } = await seedCandidate(true);
    expect(await scores.resetPendingForCandidate(candidateId)).toEqual([]);
  });

  it('findPendingByVacancy returns only pending scores of that vacancy', async () => {
    const vacancy = await seedVacancy();
    const pending = await seedApplication({ vacancyId: vacancy.id });
    const scored = await seedApplication({
      vacancyId: vacancy.id,
      parsed: true,
    });
    await scores.saveResult(scored.applicationId, makeSaved(scored.cvId));
    const failed = await seedApplication({ vacancyId: vacancy.id });
    await scores.markFailed(failed.applicationId, 'boom');
    await seedApplication({});

    expect(await scores.findPendingByVacancy(vacancy.id)).toEqual([
      pending.applicationId,
    ]);
  });

  it('findBacklog returns pending/scoring scores of parsed candidates only', async () => {
    const pendingParsed = await seedApplication({ parsed: true });
    const scoringParsed = await seedApplication({ parsed: true });
    await scores.markScoring(scoringParsed.applicationId);
    const scoredParsed = await seedApplication({ parsed: true });
    await scores.saveResult(
      scoredParsed.applicationId,
      makeSaved(scoredParsed.cvId),
    );
    const failedParsed = await seedApplication({ parsed: true });
    await scores.markFailed(failedParsed.applicationId, 'boom');
    const pendingUnparsed = await seedApplication({ parsed: false });

    const backlog = await scores.findBacklog();

    expect(backlog).toEqual(
      expect.arrayContaining([
        pendingParsed.applicationId,
        scoringParsed.applicationId,
      ]),
    );
    expect(backlog).not.toContain(scoredParsed.applicationId);
    expect(backlog).not.toContain(failedParsed.applicationId);
    expect(backlog).not.toContain(pendingUnparsed.applicationId);
  });

  describe('findScoreState', () => {
    it('returns the vacancy, candidate and score fields the worker needs', async () => {
      const vacancy = await seedVacancy({
        title: 'Data Engineer',
        requirements: 'Spark',
      });
      const { applicationId, candidateId, cvId } = await seedApplication({
        vacancyId: vacancy.id,
        parsed: true,
      });
      const criteria = [
        { id: 'c1', text: 'Knows Spark', importance: 'must' as const },
      ];
      await vacancies.saveCriteria(
        vacancy.id,
        criteria,
        vacancyCriteriaHash('Data Engineer', 'Spark'),
      );
      await scores.saveResult(applicationId, makeSaved(cvId));

      const state = await scores.findScoreState(applicationId);

      expect(state).toEqual({
        applicationId,
        vacancyId: vacancy.id,
        candidateId,
        status: 'scored',
        candidateParseStatus: 'parsed',
        candidateParsedCvDocumentId: cvId,
        vacancyTitle: 'Data Engineer',
        vacancyRequirements: 'Spark',
        vacancyCriteria: criteria,
        vacancyCriteriaHash: vacancyCriteriaHash('Data Engineer', 'Spark'),
        scoreCvDocumentId: cvId,
        scoreCriteriaHash: 'hash-1',
      });
    });

    it('reports unparsed candidates and missing criteria', async () => {
      const { applicationId } = await seedApplication({ parsed: false });

      const state = await scores.findScoreState(applicationId);

      expect(state).toMatchObject({
        status: 'pending',
        candidateParseStatus: 'pending',
        candidateParsedCvDocumentId: null,
        vacancyCriteria: null,
        vacancyCriteriaHash: null,
        scoreCvDocumentId: null,
        scoreCriteriaHash: null,
      });
    });

    it('returns null for an unknown application or one without a score row', async () => {
      const { applicationId } = await seedApplication({ withScore: false });
      expect(await scores.findScoreState(applicationId)).toBeNull();
      expect(await scores.findScoreState(randomUUID())).toBeNull();
    });
  });

  it('deletes the score row together with its application', async () => {
    const { applicationId } = await seedApplication({});
    await testDb.pool.query('DELETE FROM applications WHERE id = $1', [
      applicationId,
    ]);
    expect(await rawScore(applicationId)).toBeUndefined();
  });
});
