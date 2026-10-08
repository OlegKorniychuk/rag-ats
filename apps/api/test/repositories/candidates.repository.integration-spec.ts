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
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
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
  let cvDocumentsRepository: CvDocumentsRepository;

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
    cvDocumentsRepository = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  async function addCv(candidateId: string): Promise<void> {
    await cvDocumentsRepository.create({
      candidateId,
      filename: 'cv.pdf',
      sizeBytes: 3,
      content: Buffer.from('pdf'),
      text: 'cv text',
    });
  }

  async function seedCandidate(
    overrides: Partial<NewCandidate> = {},
  ): Promise<{ id: string; email: string }> {
    const candidate = await candidatesRepository.create(
      newCandidate(overrides),
    );
    await addCv(candidate.id);
    return candidate;
  }

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

    // keep the shared test DB valid for later findAll reads
    await addCv(created.id);
  });

  it('rejects a duplicate email', async () => {
    const email = `${randomUUID()}@example.com`;
    const first = await candidatesRepository.create(newCandidate({ email }));
    await addCv(first.id);

    await expect(
      candidatesRepository.create(newCandidate({ email })),
    ).rejects.toThrow();
  });

  it('findAll returns candidates newest first', async () => {
    const first = await seedCandidate();
    const second = await seedCandidate();

    const all = await candidatesRepository.findAll();

    const firstIndex = all.findIndex((c) => c.id === first.id);
    const secondIndex = all.findIndex((c) => c.id === second.id);

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeLessThan(firstIndex);
  });

  it('findById returns the row for a known id', async () => {
    const created = await seedCandidate();

    const found = await candidatesRepository.findById(created.id);

    expect(found).toMatchObject(created);
    expect(found?.cv.filename).toBe('cv.pdf');
    expect(found?.cv.sizeBytes).toBe(3);
    expect(found?.cv.uploadedAt).toBeInstanceOf(Date);
    expect(Object.keys(found!.cv).sort()).toEqual([
      'filename',
      'id',
      'sizeBytes',
      'uploadedAt',
    ]);
    expect(found).not.toHaveProperty('cvDocuments');
  });

  it('findById returns null for an unknown id', async () => {
    const found = await candidatesRepository.findById(randomUUID());

    expect(found).toBeNull();
  });

  it('findByEmail returns the row for a known email', async () => {
    const created = await seedCandidate();

    const found = await candidatesRepository.findByEmail(created.email);

    expect(found).toMatchObject(created);
    expect(Object.keys(found!.cv).sort()).toEqual([
      'filename',
      'id',
      'sizeBytes',
      'uploadedAt',
    ]);
    expect(found).not.toHaveProperty('cvDocuments');
  });

  it('findAll returns cv summaries without content or text', async () => {
    const created = await seedCandidate();

    const all = await candidatesRepository.findAll();

    const found = all.find((c) => c.id === created.id);
    expect(Object.keys(found!.cv).sort()).toEqual([
      'filename',
      'id',
      'sizeBytes',
      'uploadedAt',
    ]);
    expect(found).not.toHaveProperty('cvDocuments');
  });

  it('reads throw an invariant error for a candidate with no CV', async () => {
    const created = await candidatesRepository.create(newCandidate());
    const invariant = `Invariant violated: candidate ${created.id} has no CV`;

    await expect(candidatesRepository.findById(created.id)).rejects.toThrow(
      invariant,
    );
    await expect(
      candidatesRepository.findByEmail(created.email),
    ).rejects.toThrow(invariant);
    await expect(candidatesRepository.findAll()).rejects.toThrow(
      'Invariant violated',
    );

    // keep the shared test DB valid for any later findAll
    await testDb.pool.query('DELETE FROM candidates WHERE id = $1', [
      created.id,
    ]);
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
