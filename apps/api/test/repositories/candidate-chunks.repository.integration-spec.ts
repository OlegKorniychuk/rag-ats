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
  type ApplicationsRepository,
} from '../../src/db/repositories/applications.repository.js';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
  type NewCandidateChunk,
} from '../../src/db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
import {
  RECRUITERS_REPOSITORY,
  type RecruitersRepository,
} from '../../src/db/repositories/recruiters.repository.js';
import {
  VACANCIES_REPOSITORY,
  type VacanciesRepository,
} from '../../src/db/repositories/vacancies.repository.js';
import { EMBEDDING_DIMENSIONS } from '../../src/llm/embedding.constants.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

interface ChunkRow {
  candidate_id: string;
  cv_document_id: string;
  source: string;
  chunk_index: number;
  text: string;
  model: string;
  dims: number;
}

/** A unit-ish vector with `value` in the first slot. */
function vector(value: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[0] = value;
  return v;
}

function chunk(
  source: 'cv' | 'github',
  text: string,
  value = 1,
): NewCandidateChunk {
  return { source, text, embedding: vector(value) };
}

describe('CandidateChunksRepository (Testcontainers integration)', () => {
  let testDb: TestDatabase;
  let chunks: CandidateChunksRepository;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;
  let recruiters: RecruitersRepository;
  let vacancies: VacanciesRepository;
  let applications: ApplicationsRepository;

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

    chunks = moduleRef.get(CANDIDATE_CHUNKS_REPOSITORY);
    candidates = moduleRef.get(CANDIDATES_REPOSITORY);
    cvDocuments = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
    recruiters = moduleRef.get(RECRUITERS_REPOSITORY);
    vacancies = moduleRef.get(VACANCIES_REPOSITORY);
    applications = moduleRef.get(APPLICATIONS_REPOSITORY);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  async function seed(): Promise<{ candidateId: string; cvId: string }> {
    const candidate = await candidates.create({
      name: 'Jane Doe',
      email: `${randomUUID()}@example.com`,
      githubUrl: null,
      portfolioUrl: null,
      skills: [],
      experience: '',
      projects: [],
      summary: '',
    });
    return { candidateId: candidate.id, cvId: await addCv(candidate.id) };
  }

  async function addCv(candidateId: string): Promise<string> {
    const cv = await cvDocuments.create({
      candidateId,
      filename: 'cv.pdf',
      sizeBytes: 3,
      content: Buffer.from('pdf'),
      text: 'cv text',
    });
    return cv.id;
  }

  async function rows(candidateId: string): Promise<ChunkRow[]> {
    const result = await testDb.pool.query<ChunkRow>(
      `SELECT candidate_id, cv_document_id, source, chunk_index, text, model,
              vector_dims(embedding) AS dims
       FROM candidate_chunks WHERE candidate_id = $1 ORDER BY chunk_index`,
      [candidateId],
    );
    return result.rows;
  }

  it('inserts chunks with indexes, source, model and 1536-dim embeddings', async () => {
    const { candidateId, cvId } = await seed();

    await chunks.replaceForCandidate(
      candidateId,
      cvId,
      [chunk('cv', 'first'), chunk('cv', 'second'), chunk('github', 'third')],
      'embed-model',
    );

    expect(await rows(candidateId)).toEqual([
      {
        candidate_id: candidateId,
        cv_document_id: cvId,
        source: 'cv',
        chunk_index: 0,
        text: 'first',
        model: 'embed-model',
        dims: EMBEDDING_DIMENSIONS,
      },
      expect.objectContaining({ chunk_index: 1, text: 'second', source: 'cv' }),
      expect.objectContaining({
        chunk_index: 2,
        text: 'third',
        source: 'github',
      }),
    ]);
  });

  it('stores the embedding values', async () => {
    const { candidateId, cvId } = await seed();

    await chunks.replaceForCandidate(
      candidateId,
      cvId,
      [chunk('cv', 'a', 0.5)],
      'm',
    );

    const result = await testDb.pool.query<{ first: number }>(
      'SELECT (embedding::real[])[1] AS first FROM candidate_chunks WHERE candidate_id = $1',
      [candidateId],
    );
    expect(result.rows[0].first).toBeCloseTo(0.5, 5);
  });

  it('replaces the previous chunks of the candidate, leaving others alone', async () => {
    const a = await seed();
    const b = await seed();
    await chunks.replaceForCandidate(
      a.candidateId,
      a.cvId,
      [chunk('cv', 'old 1'), chunk('cv', 'old 2'), chunk('cv', 'old 3')],
      'm',
    );
    await chunks.replaceForCandidate(
      b.candidateId,
      b.cvId,
      [chunk('cv', 'b only')],
      'm',
    );
    const newCvId = await addCv(a.candidateId);

    await chunks.replaceForCandidate(
      a.candidateId,
      newCvId,
      [chunk('cv', 'new 1'), chunk('github', 'new 2')],
      'm2',
    );

    const after = await rows(a.candidateId);
    expect(after.map((r) => [r.chunk_index, r.text, r.model])).toEqual([
      [0, 'new 1', 'm2'],
      [1, 'new 2', 'm2'],
    ]);
    expect(after.every((r) => r.cv_document_id === newCvId)).toBe(true);
    expect((await rows(b.candidateId)).map((r) => r.text)).toEqual(['b only']);
  });

  it('clears the chunks when replaced with an empty list', async () => {
    const { candidateId, cvId } = await seed();
    await chunks.replaceForCandidate(
      candidateId,
      cvId,
      [chunk('cv', 'x')],
      'm',
    );

    await chunks.replaceForCandidate(candidateId, cvId, [], 'm');

    expect(await rows(candidateId)).toEqual([]);
  });

  it('rejects a vector of the wrong size and an unknown source', async () => {
    const { candidateId, cvId } = await seed();

    await expect(
      chunks.replaceForCandidate(
        candidateId,
        cvId,
        [{ source: 'cv', text: 'x', embedding: [1, 2, 3] }],
        'm',
      ),
    ).rejects.toThrow();
    await expect(
      chunks.replaceForCandidate(
        candidateId,
        cvId,
        [{ source: 'web' as 'cv', text: 'x', embedding: vector(1) }],
        'm',
      ),
    ).rejects.toThrow();
  });

  it('cascades from both the candidate and the CV document foreign keys', async () => {
    // A candidate with CVs can't be deleted (cv_documents restricts), so the
    // candidate side is checked on the constraint itself.
    const result = await testDb.pool.query<{ column: string; rule: string }>(
      `SELECT a.attname AS "column", c.confdeltype AS rule
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.conrelid = 'candidate_chunks'::regclass AND c.contype = 'f'`,
    );
    const rules = Object.fromEntries(
      result.rows.map((r) => [r.column, r.rule]),
    );
    expect(rules).toEqual({ candidate_id: 'c', cv_document_id: 'c' });
  });

  it('cascades when the CV document is deleted', async () => {
    const { candidateId, cvId } = await seed();
    await chunks.replaceForCandidate(
      candidateId,
      cvId,
      [chunk('cv', 'x')],
      'm',
    );

    await testDb.pool.query('DELETE FROM cv_documents WHERE id = $1', [cvId]);

    expect(await rows(candidateId)).toEqual([]);
  });

  describe('findNearest', () => {
    /** Unit vector in the x/y plane of axes `axis` and `axis + 1`, at `angle` radians from `axis`. */
    function planar(axis: number, angle: number): number[] {
      const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
      v[axis] = Math.cos(angle);
      v[axis + 1] = Math.sin(angle);
      return v;
    }

    // Each test uses its own axis pair so rows left by other tests (which sit
    // on axis 0) and by other findNearest tests never outrank its own rows.
    it('returns the nearest chunks first with similarity = 1 - cosine distance', async () => {
      const near = await seed();
      const mid = await seed();
      const far = await seed();
      await chunks.replaceForCandidate(
        near.candidateId,
        near.cvId,
        [{ source: 'cv', text: 'near', embedding: planar(10, 0) }],
        'm',
      );
      await chunks.replaceForCandidate(
        mid.candidateId,
        mid.cvId,
        [
          {
            source: 'github',
            text: 'mid',
            embedding: planar(10, Math.PI / 3),
          },
        ],
        'm',
      );
      await chunks.replaceForCandidate(
        far.candidateId,
        far.cvId,
        [{ source: 'cv', text: 'far', embedding: planar(10, Math.PI / 2) }],
        'm',
      );

      const hits = await chunks.findNearest(planar(10, 0), 3);

      expect(hits.map((h) => h.text)).toEqual(['near', 'mid', 'far']);
      expect(hits[0]).toMatchObject({
        candidateId: near.candidateId,
        source: 'cv',
        text: 'near',
      });
      expect(hits[1]).toMatchObject({
        candidateId: mid.candidateId,
        source: 'github',
      });
      expect(hits[0].similarity).toBeCloseTo(1, 5);
      expect(hits[1].similarity).toBeCloseTo(0.5, 5);
      expect(hits[2].similarity).toBeCloseTo(0, 5);
      expect(typeof hits[0].similarity).toBe('number');
    });

    it('returns several chunks of one candidate and respects the limit', async () => {
      const a = await seed();
      const b = await seed();
      await chunks.replaceForCandidate(
        a.candidateId,
        a.cvId,
        [
          { source: 'cv', text: 'a1', embedding: planar(20, 0.1) },
          { source: 'cv', text: 'a2', embedding: planar(20, 0.2) },
        ],
        'm',
      );
      await chunks.replaceForCandidate(
        b.candidateId,
        b.cvId,
        [{ source: 'cv', text: 'b1', embedding: planar(20, 0.3) }],
        'm',
      );

      const limited = await chunks.findNearest(planar(20, 0), 2);

      expect(limited.map((h) => h.text)).toEqual(['a1', 'a2']);
      expect(limited.every((h) => h.candidateId === a.candidateId)).toBe(true);
      expect(await chunks.findNearest(planar(20, 0), 0)).toEqual([]);
    });

    it('skips chunks of candidates who applied to the excluded vacancy only', async () => {
      const recruiter = await recruiters.create({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'hashed-password',
      });
      const newVacancy = () =>
        vacancies.create({
          recruiterId: recruiter.id,
          title: 'Engineer',
          requirements: 'Things',
          applyToken: randomUUID(),
        });
      const vacancy = await newVacancy();
      const otherVacancy = await newVacancy();
      const applicant = await seed();
      const otherApplicant = await seed();
      const free = await seed();
      await chunks.replaceForCandidate(
        applicant.candidateId,
        applicant.cvId,
        [{ source: 'cv', text: 'applicant', embedding: planar(30, 0.1) }],
        'm',
      );
      await chunks.replaceForCandidate(
        otherApplicant.candidateId,
        otherApplicant.cvId,
        [{ source: 'cv', text: 'other applicant', embedding: planar(30, 0.2) }],
        'm',
      );
      await chunks.replaceForCandidate(
        free.candidateId,
        free.cvId,
        [{ source: 'cv', text: 'free', embedding: planar(30, 0.3) }],
        'm',
      );
      await applications.create({
        vacancyId: vacancy.id,
        candidateId: applicant.candidateId,
      });
      await applications.create({
        vacancyId: otherVacancy.id,
        candidateId: otherApplicant.candidateId,
      });

      const query = planar(30, 0);
      const excluded = await chunks.findNearest(query, 2, {
        excludeVacancyId: vacancy.id,
      });
      const plain = await chunks.findNearest(query, 3);
      const emptyOptions = await chunks.findNearest(query, 3, {});
      const limited = await chunks.findNearest(query, 1, {
        excludeVacancyId: vacancy.id,
      });

      expect(excluded.map((h) => h.text)).toEqual(['other applicant', 'free']);
      // the exclusion happens before the limit: the freed slot goes to the next chunk
      expect(limited.map((h) => h.text)).toEqual(['other applicant']);
      expect(plain.map((h) => h.text)).toEqual([
        'applicant',
        'other applicant',
        'free',
      ]);
      expect(emptyOptions).toEqual(plain);
    });
  });
});
