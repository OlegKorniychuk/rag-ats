import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
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

describe('VacanciesRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let recruitersRepository: RecruitersRepository;
  let vacanciesRepository: VacanciesRepository;
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

    const recruiter = await recruitersRepository.create(newRecruiter());
    recruiterId = recruiter.id;
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  it('persists a vacancy row with a recruiter FK', async () => {
    const data = newVacancy(recruiterId);

    const created = await vacanciesRepository.create(data);

    expect(created.id).toBeDefined();
    expect(created.recruiterId).toBe(recruiterId);
    expect(created.title).toBe(data.title);
    expect(created.applyToken).toBe(data.applyToken);
    expect(created.status).toBe('open');
  });

  it('rejects a duplicate applyToken', async () => {
    const token = randomUUID();
    await vacanciesRepository.create(
      newVacancy(recruiterId, { applyToken: token }),
    );

    await expect(
      vacanciesRepository.create(
        newVacancy(recruiterId, { applyToken: token }),
      ),
    ).rejects.toThrow();
  });

  it('findById returns the row for a known id', async () => {
    const created = await vacanciesRepository.create(newVacancy(recruiterId));

    const found = await vacanciesRepository.findById(created.id);

    expect(found).toEqual(created);
  });

  it('findById returns null for an unknown id', async () => {
    const found = await vacanciesRepository.findById(randomUUID());

    expect(found).toBeNull();
  });

  it('update persists a partial change and leaves other fields untouched', async () => {
    const created = await vacanciesRepository.create(newVacancy(recruiterId));

    const updated = await vacanciesRepository.update(created.id, {
      status: 'closed',
    });

    expect(updated.status).toBe('closed');
    expect(updated.title).toBe(created.title);
    expect(updated.requirements).toBe(created.requirements);
    expect(updated.applyToken).toBe(created.applyToken);
  });

  it("findByRecruiterId returns only that recruiter's vacancies, newest first", async () => {
    const owner = await recruitersRepository.create(newRecruiter());
    const other = await recruitersRepository.create(newRecruiter());
    await vacanciesRepository.create(
      newVacancy(other.id, { title: 'Other recruiter vacancy' }),
    );
    const first = await vacanciesRepository.create(
      newVacancy(owner.id, { title: 'First' }),
    );
    const second = await vacanciesRepository.create(
      newVacancy(owner.id, { title: 'Second' }),
    );

    const found = await vacanciesRepository.findByRecruiterId(owner.id);

    expect(found.map((v) => v.id)).toEqual([second.id, first.id]);
    expect(found.every((v) => v.recruiterId === owner.id)).toBe(true);
  });

  it('findByRecruiterId returns an empty array for a recruiter with no vacancies', async () => {
    const lonely = await recruitersRepository.create(newRecruiter());

    const found = await vacanciesRepository.findByRecruiterId(lonely.id);

    expect(found).toEqual([]);
  });
});
