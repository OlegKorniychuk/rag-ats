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
  type NewCvDocument,
} from '../../src/db/repositories/cv-documents.repository.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

function newCvDocument(
  candidateId: string,
  overrides: Partial<NewCvDocument> = {},
): NewCvDocument {
  const content = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x80]);
  return {
    candidateId,
    filename: 'cv.pdf',
    sizeBytes: content.length,
    content,
    text: 'Jane Doe - Backend engineer',
    ...overrides,
  };
}

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

describe('CvDocumentsRepository (Testcontainers integration)', () => {
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

  it('create round-trips bytes and text exactly and returns a summary without content', async () => {
    const candidate = await candidatesRepository.create(newCandidate());
    const data = newCvDocument(candidate.id, {
      text: 'Ünïcödé résumé text',
    });

    const created = await cvDocumentsRepository.create(data);

    expect(Object.keys(created).sort()).toEqual([
      'filename',
      'id',
      'sizeBytes',
      'uploadedAt',
    ]);
    expect(created.filename).toBe(data.filename);
    expect(created.sizeBytes).toBe(data.sizeBytes);
    expect(created.uploadedAt).toBeInstanceOf(Date);

    const found = await cvDocumentsRepository.findLatestContentByCandidate(
      candidate.id,
    );
    expect(found).not.toBeNull();
    expect(Buffer.isBuffer(found?.content)).toBe(true);
    expect(found?.content.equals(data.content)).toBe(true);
    expect(found?.filename).toBe(data.filename);

    const [row] = await testDb.pool
      .query<{ text: string }>('SELECT text FROM cv_documents WHERE id = $1', [
        created.id,
      ])
      .then((r) => r.rows);
    expect(row.text).toBe('Ünïcödé résumé text');
  });

  it('returns the newest CV from findLatestContentByCandidate and candidate reads', async () => {
    const candidate = await candidatesRepository.create(newCandidate());
    const oldContent = Buffer.from('old-cv');
    const newContent = Buffer.from('new-cv');
    await cvDocumentsRepository.create(
      newCvDocument(candidate.id, {
        filename: 'old.pdf',
        content: oldContent,
        sizeBytes: oldContent.length,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      }),
    );
    const newer = await cvDocumentsRepository.create(
      newCvDocument(candidate.id, {
        filename: 'new.pdf',
        content: newContent,
        sizeBytes: newContent.length,
        createdAt: new Date('2026-02-01T00:00:00Z'),
      }),
    );

    const latest = await cvDocumentsRepository.findLatestContentByCandidate(
      candidate.id,
    );
    expect(latest?.filename).toBe('new.pdf');
    expect(latest?.content.equals(newContent)).toBe(true);

    const byId = await candidatesRepository.findById(candidate.id);
    expect(byId?.cv.id).toBe(newer.id);
    expect(byId?.cv.filename).toBe('new.pdf');

    const byEmail = await candidatesRepository.findByEmail(candidate.email);
    expect(byEmail?.cv.id).toBe(newer.id);

    const all = await candidatesRepository.findAll();
    expect(all.find((c) => c.id === candidate.id)?.cv.id).toBe(newer.id);
  });

  it('findLatestContentByCandidate returns null for an unknown candidate', async () => {
    const found =
      await cvDocumentsRepository.findLatestContentByCandidate(randomUUID());

    expect(found).toBeNull();
  });

  it('findTextById returns the extracted text, or null when unknown', async () => {
    const candidate = await candidatesRepository.create(newCandidate());
    const cv = await cvDocumentsRepository.create(
      newCvDocument(candidate.id, { text: 'Parsed text body' }),
    );

    expect(await cvDocumentsRepository.findTextById(cv.id)).toBe(
      'Parsed text body',
    );
    expect(await cvDocumentsRepository.findTextById(randomUUID())).toBeNull();
  });
});
