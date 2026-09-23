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
  RECRUITERS_REPOSITORY,
  type NewRecruiter,
  type RecruitersRepository,
} from '../../src/db/repositories/recruiters.repository.js';
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
  let applicationsRepository: ApplicationsRepository;
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
    applicationsRepository = moduleRef.get(APPLICATIONS_REPOSITORY);

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

  async function seedCandidate(
    overrides: Partial<NewCandidate> = {},
  ): Promise<string> {
    const candidate = await candidatesRepository.create(
      newCandidate(overrides),
    );
    return candidate.id;
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
    const firstCandidate = await candidatesRepository.create(newCandidate());
    const secondCandidate = await candidatesRepository.create(newCandidate());
    const otherCandidate = await candidatesRepository.create(newCandidate());

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
});
