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
import { vacancyCriteriaHash } from '../../src/scoring/criteria-hash.js';
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

  it('findByApplyToken returns the row for a known token', async () => {
    const token = randomUUID();
    const created = await vacanciesRepository.create(
      newVacancy(recruiterId, { applyToken: token }),
    );

    const found = await vacanciesRepository.findByApplyToken(token);

    expect(found).toEqual(created);
  });

  it('findByApplyToken returns null for an unknown token', async () => {
    const found = await vacanciesRepository.findByApplyToken(randomUUID());

    expect(found).toBeNull();
  });

  describe('saveCriteria', () => {
    const criteria = [
      { id: 'c1', text: 'Node.js', importance: 'must' as const },
      { id: 'c2', text: 'Kubernetes', importance: 'nice' as const },
    ];

    async function readInternal(id: string) {
      const { rows } = await testDb.pool.query(
        'SELECT criteria, criteria_hash FROM vacancies WHERE id = $1',
        [id],
      );
      return rows[0] as { criteria: unknown; criteria_hash: string | null };
    }

    it('stores criteria when the hash still matches the vacancy text', async () => {
      const vacancy = await vacanciesRepository.create(newVacancy(recruiterId));
      const hash = vacancyCriteriaHash(vacancy.title, vacancy.requirements);

      const saved = await vacanciesRepository.saveCriteria(
        vacancy.id,
        criteria,
        hash,
      );

      expect(saved).toBe(true);
      expect(await readInternal(vacancy.id)).toEqual({
        criteria,
        criteria_hash: hash,
      });
    });

    it('returns false and stores nothing after the title or requirements changed', async () => {
      const vacancy = await vacanciesRepository.create(newVacancy(recruiterId));
      const staleHash = vacancyCriteriaHash(
        vacancy.title,
        vacancy.requirements,
      );
      await vacanciesRepository.update(vacancy.id, {
        requirements: 'Go and Kafka',
      });

      const saved = await vacanciesRepository.saveCriteria(
        vacancy.id,
        criteria,
        staleHash,
      );

      expect(saved).toBe(false);
      expect(await readInternal(vacancy.id)).toEqual({
        criteria: null,
        criteria_hash: null,
      });
    });

    it('returns false for an unknown vacancy', async () => {
      expect(
        await vacanciesRepository.saveCriteria(randomUUID(), criteria, 'x'),
      ).toBe(false);
    });

    it('never exposes the internal columns on reads', async () => {
      const vacancy = await vacanciesRepository.create(newVacancy(recruiterId));
      await vacanciesRepository.saveCriteria(
        vacancy.id,
        criteria,
        vacancyCriteriaHash(vacancy.title, vacancy.requirements),
      );

      for (const read of [
        await vacanciesRepository.findById(vacancy.id),
        await vacanciesRepository.findByApplyToken(vacancy.applyToken),
        (await vacanciesRepository.findByRecruiterId(recruiterId))[0],
        await vacanciesRepository.update(vacancy.id, { title: 'Renamed' }),
      ]) {
        expect(read).not.toHaveProperty('criteria');
        expect(read).not.toHaveProperty('criteriaHash');
      }
    });
  });
});
