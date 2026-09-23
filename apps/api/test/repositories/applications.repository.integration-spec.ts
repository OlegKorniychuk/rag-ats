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
});
