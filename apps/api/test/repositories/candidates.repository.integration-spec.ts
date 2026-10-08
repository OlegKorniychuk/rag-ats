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
    // keep the shared test DB valid for later findAll reads
    await addCv(created.id);

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

  describe('parse state', () => {
    const profile = {
      skills: ['Go', 'Kubernetes'],
      experience: '4 years of platform work',
      projects: ['Cluster autoscaler'],
      summary: 'Platform engineer.',
    };

    it('a new candidate is pending with no parse error', async () => {
      const created = await seedCandidate();

      const found = await candidatesRepository.findById(created.id);

      expect(found?.parseStatus).toBe('pending');
      expect(found?.parseError).toBeNull();
    });

    it('setParseStatus sets the status, with and without an error', async () => {
      const created = await seedCandidate();

      await candidatesRepository.setParseStatus(created.id, 'failed', 'boom');
      let found = await candidatesRepository.findById(created.id);
      expect(found?.parseStatus).toBe('failed');
      expect(found?.parseError).toBe('boom');

      await candidatesRepository.setParseStatus(created.id, 'parsing');
      found = await candidatesRepository.findById(created.id);
      expect(found?.parseStatus).toBe('parsing');
      expect(found?.parseError).toBeNull();
    });

    it('markParsing moves pending/failed/parsing to parsing and clears the error', async () => {
      for (const from of ['pending', 'failed', 'parsing'] as const) {
        const created = await seedCandidate();
        await candidatesRepository.setParseStatus(created.id, from, 'x');

        expect(await candidatesRepository.markParsing(created.id)).toBe(true);

        const found = await candidatesRepository.findById(created.id);
        expect(found?.parseStatus).toBe('parsing');
        expect(found?.parseError).toBeNull();
      }
    });

    it('markParsing refuses a parsed or unknown candidate and changes nothing', async () => {
      const created = await seedCandidate();
      await candidatesRepository.setParseStatus(created.id, 'parsed');

      expect(await candidatesRepository.markParsing(created.id)).toBe(false);
      expect(
        (await candidatesRepository.findById(created.id))?.parseStatus,
      ).toBe('parsed');
      expect(await candidatesRepository.markParsing(randomUUID())).toBe(false);
    });

    it('saveParsedProfile writes the profile, marks parsed and clears the error', async () => {
      const created = await seedCandidate();
      const state = await candidatesRepository.findParseState(created.id);
      await candidatesRepository.setParseStatus(created.id, 'failed', 'boom');

      await candidatesRepository.saveParsedProfile(
        created.id,
        state!.latestCvDocumentId,
        profile,
      );

      const found = await candidatesRepository.findById(created.id);
      expect(found).toMatchObject({
        ...profile,
        parseStatus: 'parsed',
        parseError: null,
      });
      const after = await candidatesRepository.findParseState(created.id);
      expect(after).toEqual({
        id: created.id,
        parseStatus: 'parsed',
        parsedCvDocumentId: state!.latestCvDocumentId,
        latestCvDocumentId: state!.latestCvDocumentId,
      });
      const { rows } = await testDb.pool.query(
        'SELECT parsed_at FROM candidates WHERE id = $1',
        [created.id],
      );
      expect(rows[0].parsed_at).toBeInstanceOf(Date);
    });

    it('findParseState tracks the newest CV and is null for unknown ids', async () => {
      const created = await seedCandidate();
      const first = await candidatesRepository.findParseState(created.id);
      expect(first).toMatchObject({
        parseStatus: 'pending',
        parsedCvDocumentId: null,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await addCv(created.id);

      const second = await candidatesRepository.findParseState(created.id);
      const latest = await candidatesRepository.findById(created.id);
      expect(second!.latestCvDocumentId).not.toBe(first!.latestCvDocumentId);
      expect(second!.latestCvDocumentId).toBe(latest!.cv.id);

      expect(
        await candidatesRepository.findParseState(randomUUID()),
      ).toBeNull();
    });

    it('findParseBacklog returns only pending/parsing candidates with their latest CV', async () => {
      const pending = await seedCandidate();
      const parsing = await seedCandidate();
      const parsed = await seedCandidate();
      const failed = await seedCandidate();
      await candidatesRepository.setParseStatus(parsing.id, 'parsing');
      await candidatesRepository.setParseStatus(parsed.id, 'parsed');
      await candidatesRepository.setParseStatus(failed.id, 'failed', 'x');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await addCv(pending.id);

      const backlog = await candidatesRepository.findParseBacklog();

      const ids = backlog.map((b) => b.candidateId);
      expect(ids).toContain(pending.id);
      expect(ids).toContain(parsing.id);
      expect(ids).not.toContain(parsed.id);
      expect(ids).not.toContain(failed.id);
      const pendingLatest = await candidatesRepository.findById(pending.id);
      expect(backlog.find((b) => b.candidateId === pending.id)).toEqual({
        candidateId: pending.id,
        cvDocumentId: pendingLatest!.cv.id,
      });
    });

    it('reads never expose internal parse columns or CV content', async () => {
      const created = await seedCandidate();
      const state = await candidatesRepository.findParseState(created.id);
      await candidatesRepository.saveParsedProfile(
        created.id,
        state!.latestCvDocumentId,
        profile,
      );
      const expectedKeys = [
        'id',
        'name',
        'email',
        'githubUrl',
        'portfolioUrl',
        'skills',
        'experience',
        'projects',
        'summary',
        'parseStatus',
        'parseError',
        'createdAt',
        'cv',
      ].sort();

      const byId = await candidatesRepository.findById(created.id);
      const byEmail = await candidatesRepository.findByEmail(created.email);
      const all = await candidatesRepository.findAll();
      const fromAll = all.find((c) => c.id === created.id);

      for (const found of [byId, byEmail, fromAll]) {
        expect(Object.keys(found!).sort()).toEqual(expectedKeys);
      }
      const updated = await candidatesRepository.update(created.id, {
        name: 'Renamed',
      });
      expect(Object.keys(updated).sort()).toEqual(
        expectedKeys.filter((k) => k !== 'cv'),
      );
    });
  });
});
