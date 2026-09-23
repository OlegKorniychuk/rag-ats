import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  CANDIDATES_REPOSITORY,
  type NewCandidate,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

function newCandidate(overrides: Partial<NewCandidate> = {}): NewCandidate {
  return {
    name: 'Jane Doe',
    email: `${randomUUID()}@example.com`,
    githubUrl: 'https://github.com/janedoe',
    portfolioUrl: 'https://janedoe.dev',
    skills: ['TypeScript', 'NestJS'],
    experience: '5 years of backend development',
    projects: ['RAG-ATS', 'Personal blog'],
    summary: 'Backend engineer with a focus on TypeScript.',
    ...overrides,
  };
}

describe('CandidatesRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let candidatesRepository: CandidatesRepository;

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

    candidatesRepository = moduleRef.get(CANDIDATES_REPOSITORY);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  it('persists a candidate row with all fields, including arrays', async () => {
    const data = newCandidate();

    const created = await candidatesRepository.create(data);

    expect(created.id).toBeDefined();
    expect(created.name).toBe(data.name);
    expect(created.email).toBe(data.email);
    expect(created.githubUrl).toBe(data.githubUrl);
    expect(created.portfolioUrl).toBe(data.portfolioUrl);
    expect(created.skills).toEqual(data.skills);
    expect(created.experience).toBe(data.experience);
    expect(created.projects).toEqual(data.projects);
    expect(created.summary).toBe(data.summary);
  });

  it('rejects a duplicate email', async () => {
    const email = `${randomUUID()}@example.com`;
    await candidatesRepository.create(newCandidate({ email }));

    await expect(
      candidatesRepository.create(newCandidate({ email })),
    ).rejects.toThrow();
  });

  it('findAll returns candidates newest first', async () => {
    const first = await candidatesRepository.create(newCandidate());
    const second = await candidatesRepository.create(newCandidate());

    const all = await candidatesRepository.findAll();

    const firstIndex = all.findIndex((c) => c.id === first.id);
    const secondIndex = all.findIndex((c) => c.id === second.id);

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeLessThan(firstIndex);
  });

  it('findById returns the row for a known id', async () => {
    const created = await candidatesRepository.create(newCandidate());

    const found = await candidatesRepository.findById(created.id);

    expect(found).toEqual(created);
  });

  it('findById returns null for an unknown id', async () => {
    const found = await candidatesRepository.findById(randomUUID());

    expect(found).toBeNull();
  });

  it('findByEmail returns the row for a known email', async () => {
    const created = await candidatesRepository.create(newCandidate());

    const found = await candidatesRepository.findByEmail(created.email);

    expect(found).toEqual(created);
  });

  it('findByEmail returns null for an unknown email', async () => {
    const found = await candidatesRepository.findByEmail(
      `${randomUUID()}@example.com`,
    );

    expect(found).toBeNull();
  });

  it('update persists a partial change and leaves other fields untouched', async () => {
    const created = await candidatesRepository.create(newCandidate());

    const updated = await candidatesRepository.update(created.id, {
      skills: ['Go', 'Kubernetes'],
      summary: 'Updated summary after a career shift.',
    });

    expect(updated.skills).toEqual(['Go', 'Kubernetes']);
    expect(updated.summary).toBe('Updated summary after a career shift.');
    expect(updated.name).toBe(created.name);
    expect(updated.email).toBe(created.email);
    expect(updated.githubUrl).toBe(created.githubUrl);
    expect(updated.portfolioUrl).toBe(created.portfolioUrl);
    expect(updated.experience).toBe(created.experience);
    expect(updated.projects).toEqual(created.projects);
  });
});
