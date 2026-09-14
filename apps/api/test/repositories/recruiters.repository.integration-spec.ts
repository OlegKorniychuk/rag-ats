import { randomUUID } from 'crypto';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import {
  ClsPluginTransactional,
  Transactional,
} from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens';
import { recruiters } from '../../src/db/schema';
import { RepositoriesModule } from '../../src/db/repositories.module';
import {
  NewRecruiter,
  RECRUITERS_REPOSITORY,
  RecruitersRepository,
} from '../../src/db/repositories/recruiters.repository';
import {
  createTestDatabase,
  teardownTestDatabase,
  TestDatabase,
} from '../testcontainers-db.util';

function newRecruiter(): NewRecruiter {
  return {
    email: `${randomUUID()}@example.com`,
    passwordHash: 'hashed-password',
  };
}

@Injectable()
class TestTransactionalService {
  constructor(
    @Inject(RECRUITERS_REPOSITORY)
    private readonly recruitersRepository: RecruitersRepository,
  ) {}

  @Transactional()
  async createTwoAndCommit(a: NewRecruiter, b: NewRecruiter) {
    await this.recruitersRepository.create(a);
    await this.recruitersRepository.create(b);
  }

  @Transactional()
  async createTwoThenFail(a: NewRecruiter, b: NewRecruiter) {
    await this.recruitersRepository.create(a);
    await this.recruitersRepository.create(b);
    throw new Error('deliberate failure to trigger rollback');
  }
}

describe('RecruitersRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let recruitersRepository: RecruitersRepository;
  let transactionalService: TestTransactionalService;

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
      providers: [TestTransactionalService],
    }).compile();

    recruitersRepository = moduleRef.get(RECRUITERS_REPOSITORY);
    transactionalService = moduleRef.get(TestTransactionalService);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  it('persists a record created outside any transaction', async () => {
    const data = newRecruiter();

    const created = await recruitersRepository.create(data);

    expect(created.email).toBe(data.email);
    const found = await recruitersRepository.findByEmail(data.email);
    expect(found).not.toBeNull();
  });

  it('commits all writes made inside a @Transactional() method', async () => {
    const a = newRecruiter();
    const b = newRecruiter();

    await transactionalService.createTwoAndCommit(a, b);

    const rows = await testDb.db
      .select()
      .from(recruiters)
      .where(eq(recruiters.email, a.email));
    const rowsB = await testDb.db
      .select()
      .from(recruiters)
      .where(eq(recruiters.email, b.email));
    expect(rows).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
  });

  it('rolls back all writes when a @Transactional() method throws', async () => {
    const a = newRecruiter();
    const b = newRecruiter();

    await expect(transactionalService.createTwoThenFail(a, b)).rejects.toThrow(
      'deliberate failure to trigger rollback',
    );

    const rowsA = await testDb.db
      .select()
      .from(recruiters)
      .where(eq(recruiters.email, a.email));
    const rowsB = await testDb.db
      .select()
      .from(recruiters)
      .where(eq(recruiters.email, b.email));
    expect(rowsA).toHaveLength(0);
    expect(rowsB).toHaveLength(0);
  });
});
