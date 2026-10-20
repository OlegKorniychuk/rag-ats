import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  APPLICATIONS_REPOSITORY,
  type NewApplication,
  type ApplicationsRepository,
} from '../../src/db/repositories/applications.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type NewCandidate,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
import {
  RECRUITERS_REPOSITORY,
  type NewRecruiter,
  type RecruitersRepository,
} from '../../src/db/repositories/recruiters.repository.js';
import {
  SCORES_REPOSITORY,
  type SavedScore,
  type ScoresRepository,
} from '../../src/db/repositories/scores.repository.js';
import { vacancyCriteriaHash } from '../../src/scoring/criteria-hash.js';
import {
  VACANCIES_REPOSITORY,
  type NewVacancy,
  type VacanciesRepository,
} from '../../src/db/repositories/vacancies.repository.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

function newRecruiter(): NewRecruiter {
  return {
    email: `${randomUUID()}@example.com`,
    passwordHash: 'hashed-password',
  };
}

function newVacancy(
  recruiterId: string,
  overrides: Partial<NewVacancy> = {},
): NewVacancy {
  return {
    recruiterId,
    title: 'Senior Backend Engineer',
    requirements: '5+ years Node.js, PostgreSQL',
    applyToken: randomUUID(),
    ...overrides,
  };
}

function newCandidate(overrides: Partial<NewCandidate> = {}): NewCandidate {
  return {
    name: 'Jane Doe',
    email: `${randomUUID()}@example.com`,
    skills: ['TypeScript', 'NestJS'],
    experience: '5 years of backend development',
    projects: ['RAG-ATS'],
    summary: 'Backend engineer with a focus on TypeScript.',
    ...overrides,
  };
}

describe('ApplicationsRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let recruitersRepository: RecruitersRepository;
  let vacanciesRepository: VacanciesRepository;
  let candidatesRepository: CandidatesRepository;
  let cvDocumentsRepository: CvDocumentsRepository;
  let applicationsRepository: ApplicationsRepository;
  let scoresRepository: ScoresRepository;
  let recruiterId: string;

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

    recruitersRepository = moduleRef.get(RECRUITERS_REPOSITORY);
    vacanciesRepository = moduleRef.get(VACANCIES_REPOSITORY);
    candidatesRepository = moduleRef.get(CANDIDATES_REPOSITORY);
    cvDocumentsRepository = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
    applicationsRepository = moduleRef.get(APPLICATIONS_REPOSITORY);
    scoresRepository = moduleRef.get(SCORES_REPOSITORY);

    const recruiter = await recruitersRepository.create(newRecruiter());
    recruiterId = recruiter.id;
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  async function seedVacancy(
    overrides: Partial<NewVacancy> = {},
  ): Promise<string> {
    const vacancy = await vacanciesRepository.create(
      newVacancy(recruiterId, overrides),
    );
    return vacancy.id;
  }

  async function seedCandidateWithCv(overrides: Partial<NewCandidate> = {}) {
    const candidate = await candidatesRepository.create(
      newCandidate(overrides),
    );
    await cvDocumentsRepository.create({
      candidateId: candidate.id,
      filename: 'cv.pdf',
      sizeBytes: 3,
      content: Buffer.from('pdf'),
      text: 'cv text',
    });
    return candidate;
  }

  async function seedCandidate(
    overrides: Partial<NewCandidate> = {},
  ): Promise<string> {
    return (await seedCandidateWithCv(overrides)).id;
  }

  it('creates an application defaulting stage to applied', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();
    const data: NewApplication = { vacancyId, candidateId };

    const created = await applicationsRepository.create(data);

    expect(created.id).toBeDefined();
    expect(created.vacancyId).toBe(vacancyId);
    expect(created.candidateId).toBe(candidateId);
    expect(created.stage).toBe('applied');
  });

  it('findByVacancyAndCandidate returns the row for a known pair', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();
    const created = await applicationsRepository.create({
      vacancyId,
      candidateId,
    });

    const found = await applicationsRepository.findByVacancyAndCandidate(
      vacancyId,
      candidateId,
    );

    expect(found).toEqual(created);
  });

  it('findByVacancyAndCandidate returns null for an unknown pair', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();

    const found = await applicationsRepository.findByVacancyAndCandidate(
      vacancyId,
      candidateId,
    );

    expect(found).toBeNull();
  });

  it('rejects a duplicate (vacancyId, candidateId) pair', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();
    await applicationsRepository.create({ vacancyId, candidateId });

    await expect(
      applicationsRepository.create({ vacancyId, candidateId }),
    ).rejects.toThrow();
  });

  it('allows the same candidate to apply to a second vacancy', async () => {
    const candidateId = await seedCandidate();
    const firstVacancyId = await seedVacancy();
    const secondVacancyId = await seedVacancy();
    await applicationsRepository.create({
      vacancyId: firstVacancyId,
      candidateId,
    });

    const secondApplication = await applicationsRepository.create({
      vacancyId: secondVacancyId,
      candidateId,
    });

    expect(secondApplication.vacancyId).toBe(secondVacancyId);
    expect(secondApplication.candidateId).toBe(candidateId);
  });

  it('findByVacancyIdWithCandidate returns only that vacancy applications, newest first, with candidate populated', async () => {
    const vacancyId = await seedVacancy();
    const otherVacancyId = await seedVacancy();
    const firstCandidate = await seedCandidateWithCv();
    const secondCandidate = await seedCandidateWithCv();
    const otherCandidate = await seedCandidateWithCv();

    const first = await applicationsRepository.create({
      vacancyId,
      candidateId: firstCandidate.id,
    });
    const second = await applicationsRepository.create({
      vacancyId,
      candidateId: secondCandidate.id,
    });
    await applicationsRepository.create({
      vacancyId: otherVacancyId,
      candidateId: otherCandidate.id,
    });

    const found =
      await applicationsRepository.findByVacancyIdWithCandidate(vacancyId);

    expect(found).toHaveLength(2);
    expect(found.map((a) => a.id)).toEqual([second.id, first.id]);
    expect(found.every((a) => a.vacancyId === vacancyId)).toBe(true);
    expect(found[0].candidate.id).toBe(secondCandidate.id);
    expect(found[0].candidate.email).toBe(secondCandidate.email);
    expect(found[1].candidate.id).toBe(firstCandidate.id);
    expect(found[1].candidate.email).toBe(firstCandidate.email);
    for (const application of found) {
      expect(Object.keys(application.candidate.cv).sort()).toEqual([
        'filename',
        'id',
        'sizeBytes',
        'uploadedAt',
      ]);
      expect(application.candidate.cv.filename).toBe('cv.pdf');
      expect(application.candidate).not.toHaveProperty('cvDocuments');
    }
  });

  it('findByVacancyIdWithCandidate throws an invariant error when a candidate has no CV', async () => {
    const vacancyId = await seedVacancy();
    const candidate = await candidatesRepository.create(newCandidate());
    await applicationsRepository.create({
      vacancyId,
      candidateId: candidate.id,
    });

    await expect(
      applicationsRepository.findByVacancyIdWithCandidate(vacancyId),
    ).rejects.toThrow(
      `Invariant violated: candidate ${candidate.id} has no CV`,
    );
  });

  it('findByVacancyIdWithCandidate returns an empty array for a vacancy with no applications', async () => {
    const vacancyId = await seedVacancy();

    const found =
      await applicationsRepository.findByVacancyIdWithCandidate(vacancyId);

    expect(found).toEqual([]);
  });

  it('findByIdWithVacancy returns the application with vacancy populated', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();
    const created = await applicationsRepository.create({
      vacancyId,
      candidateId,
    });

    const found = await applicationsRepository.findByIdWithVacancy(created.id);

    expect(found).not.toBeNull();
    expect(found?.vacancy.id).toBe(vacancyId);
    expect(found?.vacancy.recruiterId).toBe(recruiterId);
  });

  it('findByIdWithVacancy returns null for an unknown id', async () => {
    const found =
      await applicationsRepository.findByIdWithVacancy(randomUUID());

    expect(found).toBeNull();
  });

  it('updateStage persists the new stage and leaves other fields unchanged', async () => {
    const vacancyId = await seedVacancy();
    const candidateId = await seedCandidate();
    const created = await applicationsRepository.create({
      vacancyId,
      candidateId,
    });

    const updated = await applicationsRepository.updateStage(
      created.id,
      'screened',
    );

    expect(updated.stage).toBe('screened');
    expect(updated.vacancyId).toBe(vacancyId);
    expect(updated.candidateId).toBe(candidateId);

    const found = await applicationsRepository.findByIdWithVacancy(created.id);
    expect(found?.stage).toBe('screened');
    expect(found?.vacancyId).toBe(vacancyId);
    expect(found?.candidateId).toBe(candidateId);
  });

  describe('findByVacancyIdWithCandidate score', () => {
    const profile = {
      skills: ['TS'],
      experience: '5 years',
      projects: [],
      summary: 'Engineer.',
    };

    function savedScore(
      cvDocumentId: string,
      criteriaHash: string,
    ): SavedScore {
      return {
        result: {
          overall: 90,
          rationale: 'Strong.',
          criteria: [
            {
              criterionId: 'c1',
              criterion: 'Node.js',
              importance: 'must',
              score: 90,
              reasoning: 'Yes.',
              quotes: [{ source: 'cv', text: 'Built Node.js services' }],
            },
          ],
          cvDocumentId,
          model: 'gpt-test',
          mode: 'full_text',
          scoredAt: '2026-01-15T09:30:00.000Z',
        },
        cvDocumentId,
        criteriaHash,
        model: 'gpt-test',
        mode: 'full_text',
        inputTokens: 10,
        outputTokens: 5,
      };
    }

    // a parsed candidate applied to a vacancy whose criteria were extracted
    async function seedParsedApplication() {
      const vacancy = await vacanciesRepository.create(newVacancy(recruiterId));
      const hash = vacancyCriteriaHash(vacancy.title, vacancy.requirements);
      await vacanciesRepository.saveCriteria(
        vacancy.id,
        [{ id: 'c1', text: 'Node.js', importance: 'must' }],
        hash,
      );
      const candidate = await candidatesRepository.create(newCandidate());
      const cv = await cvDocumentsRepository.create({
        candidateId: candidate.id,
        filename: 'cv.pdf',
        sizeBytes: 3,
        content: Buffer.from('pdf'),
        text: 'cv text',
      });
      await candidatesRepository.saveParsedProfile(
        candidate.id,
        cv.id,
        profile,
        null,
      );
      const application = await applicationsRepository.create({
        vacancyId: vacancy.id,
        candidateId: candidate.id,
      });
      await scoresRepository.createPending(application.id);
      return {
        vacancyId: vacancy.id,
        candidateId: candidate.id,
        cvId: cv.id,
        applicationId: application.id,
        hash,
      };
    }

    async function readScore(vacancyId: string) {
      const [found] =
        await applicationsRepository.findByVacancyIdWithCandidate(vacancyId);
      return found;
    }

    it('maps a pending score without a result as waiting-free and not stale', async () => {
      const { vacancyId } = await seedParsedApplication();

      const found = await readScore(vacancyId);

      expect(found.score).toEqual({
        status: 'pending',
        error: null,
        waitingForParse: false,
        stale: false,
        result: null,
      });
    });

    it('maps a current scored result as not stale and exposes only the contract fields', async () => {
      const seeded = await seedParsedApplication();
      await scoresRepository.saveResult(
        seeded.applicationId,
        savedScore(seeded.cvId, seeded.hash),
      );

      const found = await readScore(seeded.vacancyId);

      expect(found.score.status).toBe('scored');
      expect(found.score.stale).toBe(false);
      expect(found.score.waitingForParse).toBe(false);
      expect(found.score.result?.overall).toBe(90);
      expect(Object.keys(found.score).sort()).toEqual([
        'error',
        'result',
        'stale',
        'status',
        'waitingForParse',
      ]);
      expect(found.candidate).not.toHaveProperty('parsedCvDocumentId');
      expect(found).not.toHaveProperty('vacancy');
    });

    it('is stale when the candidate was parsed from a newer CV', async () => {
      const seeded = await seedParsedApplication();
      await scoresRepository.saveResult(
        seeded.applicationId,
        savedScore(seeded.cvId, seeded.hash),
      );
      const newerCv = await cvDocumentsRepository.create({
        candidateId: seeded.candidateId,
        filename: 'cv2.pdf',
        sizeBytes: 3,
        content: Buffer.from('pdf'),
        text: 'new cv text',
      });
      await candidatesRepository.saveParsedProfile(
        seeded.candidateId,
        newerCv.id,
        profile,
        null,
      );

      const found = await readScore(seeded.vacancyId);

      expect(found.score.stale).toBe(true);
      expect(found.score.result).not.toBeNull();
    });

    it('is stale when the vacancy criteria hash changed', async () => {
      const seeded = await seedParsedApplication();
      await scoresRepository.saveResult(
        seeded.applicationId,
        savedScore(seeded.cvId, 'an-older-criteria-hash'),
      );

      const found = await readScore(seeded.vacancyId);

      expect(found.score.status).toBe('scored');
      expect(found.score.stale).toBe(true);
    });

    it('is stale while a rescore is pending, keeping the result', async () => {
      const seeded = await seedParsedApplication();
      await scoresRepository.saveResult(
        seeded.applicationId,
        savedScore(seeded.cvId, seeded.hash),
      );
      await scoresRepository.resetToPending(seeded.applicationId);

      const found = await readScore(seeded.vacancyId);

      expect(found.score.status).toBe('pending');
      expect(found.score.stale).toBe(true);
      expect(found.score.result?.overall).toBe(90);
    });

    it('exposes the failure reason', async () => {
      const seeded = await seedParsedApplication();
      await scoresRepository.markFailed(
        seeded.applicationId,
        'Could not ground',
      );

      const found = await readScore(seeded.vacancyId);

      expect(found.score).toMatchObject({
        status: 'failed',
        error: 'Could not ground',
        stale: false,
        result: null,
      });
    });

    it('flags waitingForParse when the candidate is not parsed', async () => {
      const vacancyId = await seedVacancy();
      const candidateId = await seedCandidate();
      const application = await applicationsRepository.create({
        vacancyId,
        candidateId,
      });
      await scoresRepository.createPending(application.id);

      const found = await readScore(vacancyId);

      expect(found.score.waitingForParse).toBe(true);
      expect(found.score.status).toBe('pending');
    });

    it('defaults to a pending score when the application has no score row', async () => {
      const vacancyId = await seedVacancy();
      const candidateId = await seedCandidate();
      await applicationsRepository.create({ vacancyId, candidateId });

      const found = await readScore(vacancyId);

      expect(found.score).toEqual({
        status: 'pending',
        error: null,
        waitingForParse: true,
        stale: false,
        result: null,
      });
    });
  });
});
