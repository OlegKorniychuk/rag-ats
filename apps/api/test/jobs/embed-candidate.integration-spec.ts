import { randomUUID } from 'crypto';
import { Global, Module } from '@nestjs/common';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterDrizzleOrm } from '@nestjs-cls/transactional-adapter-drizzle-orm';
import { Test, type TestingModule } from '@nestjs/testing';
import { setupServer } from 'msw/node';
import { ClsModule } from 'nestjs-cls';
import { EnvConfig } from '../../src/config/env.config.js';
import { DRIZZLE } from '../../src/db/db.tokens.js';
import { RepositoriesModule } from '../../src/db/repositories.module.js';
import {
  CANDIDATE_CHUNKS_REPOSITORY,
  type CandidateChunksRepository,
} from '../../src/db/repositories/candidate-chunks.repository.js';
import {
  CANDIDATES_REPOSITORY,
  type CandidatesRepository,
} from '../../src/db/repositories/candidates.repository.js';
import {
  CV_DOCUMENTS_REPOSITORY,
  type CvDocumentsRepository,
} from '../../src/db/repositories/cv-documents.repository.js';
import type { GithubSnapshot } from '../../src/github/github-snapshot.js';
import { EmbedCandidateWorker } from '../../src/jobs/embed-candidate.worker.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { JobsService } from '../../src/jobs/jobs.service.js';
import { chunkCandidate } from '../../src/rag/chunking.js';
import {
  captureOpenaiEmbeddingRequests,
  fakeEmbedding,
  openaiEmbeddingsErrorHandler,
  openaiEmbeddingsHandler,
} from '../msw/openai.handlers.js';
import {
  createTestDatabase,
  teardownTestDatabase,
  type TestDatabase,
} from '../testcontainers-db.util.js';

const EMBEDDING_MODEL = 'test-embedding-model';
const PROFILE = { skills: [], experience: '', projects: [], summary: '' };

const CV_TEXT = [
  'Jane Doe',
  'Senior Backend Engineer',
  'Designed Kafka pipelines and Kubernetes deployments with Terraform.',
].join('\n');

const SNAPSHOT: GithubSnapshot = {
  username: 'janedoe',
  profileUrl: 'https://github.com/janedoe',
  status: 'ok',
  fetchedAt: '2026-01-01T00:00:00.000Z',
  bio: 'Backend engineer. TypeScript and Go.',
  repos: [
    {
      name: 'alpha',
      url: 'https://github.com/janedoe/alpha',
      description: 'A NestJS API',
      language: 'TypeScript',
      stars: 50,
      topics: ['nestjs'],
      pushedAt: '2026-03-01T00:00:00Z',
      readmeExcerpt: 'Alpha is a REST service.',
    },
  ],
  languages: [{ name: 'TypeScript', repoCount: 1 }],
};

// OpenAI is the only HTTP dependency here; the embeddings endpoint answers
// with deterministic fake vectors unless a test installs another handler.
const server = setupServer(openaiEmbeddingsHandler());
const capture = captureOpenaiEmbeddingRequests();

async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting; last value: ${JSON.stringify(value)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface ChunkRow {
  source: string;
  chunk_index: number;
  text: string;
  model: string;
  cv_document_id: string;
  embedding: string;
}

describe('Embed candidate jobs (Testcontainers + MSW + real pg-boss)', () => {
  let testDb: TestDatabase;
  let moduleRef: TestingModule | undefined;
  let candidates: CandidatesRepository;
  let cvDocuments: CvDocumentsRepository;
  let chunks: CandidateChunksRepository;
  let worker: EmbedCandidateWorker;

  async function boot() {
    @Global()
    @Module({
      providers: [{ provide: DRIZZLE, useValue: testDb.db }],
      exports: [DRIZZLE],
    })
    class TestDbModule {}

    const config = {
      DATABASE_URL: 'postgres://unused',
      OPENAI_API_KEY: 'sk-test-dummy',
      OPENAI_MODEL: 'test-model',
      OPENAI_EMBEDDING_MODEL: EMBEDDING_MODEL,
      JOBS_POLL_INTERVAL_SECONDS: 0.5,
    } as EnvConfig;

    @Global()
    @Module({
      providers: [{ provide: EnvConfig, useValue: config }],
      exports: [EnvConfig],
    })
    class TestConfigModule {}

    moduleRef = await Test.createTestingModule({
      imports: [
        TestConfigModule,
        TestDbModule,
        ClsModule.forRoot({
          global: true,
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
        JobsModule,
      ],
    }).compile();
    await moduleRef.init();

    candidates = moduleRef.get(CANDIDATES_REPOSITORY);
    cvDocuments = moduleRef.get(CV_DOCUMENTS_REPOSITORY);
    chunks = moduleRef.get(CANDIDATE_CHUNKS_REPOSITORY);
    worker = moduleRef.get(EmbedCandidateWorker);
  }

  async function shutdown() {
    await moduleRef?.close();
    moduleRef = undefined;
  }

  async function addCv(candidateId: string, text: string, order = 0) {
    const content = Buffer.from(text);
    const cv = await cvDocuments.create({
      candidateId,
      filename: 'cv.pdf',
      sizeBytes: content.length,
      content,
      text,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, order)),
    });
    return cv.id;
  }

  /** A candidate with one CV, optionally already parsed (with a snapshot). */
  async function seed(
    options: {
      cvText?: string;
      parsed?: boolean;
      snapshot?: GithubSnapshot | null;
    } = {},
  ) {
    const { cvText = CV_TEXT, parsed = true, snapshot = SNAPSHOT } = options;
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
    const cvId = await addCv(candidate.id, cvText);
    if (parsed) {
      await candidates.saveParsedProfile(candidate.id, cvId, PROFILE, snapshot);
    }
    return { candidateId: candidate.id, cvId };
  }

  async function chunkRows(candidateId: string): Promise<ChunkRow[]> {
    const result = await testDb.pool.query<ChunkRow>(
      `SELECT source, chunk_index, text, model, cv_document_id, embedding::text AS embedding
       FROM candidate_chunks WHERE candidate_id = $1 ORDER BY chunk_index`,
      [candidateId],
    );
    return result.rows;
  }

  const embeddedId = async (candidateId: string) =>
    (await candidates.findEmbedState(candidateId))?.embeddedCvDocumentId;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    server.listen({ onUnhandledFrame: 'error' });
    server.events.on('request:start', capture.listener);
  }, 120_000);

  afterEach(() => {
    server.resetHandlers();
    capture.bodies.length = 0;
  });

  afterAll(async () => {
    await shutdown();
    server.close();
    await teardownTestDatabase(testDb);
  });

  describe('worker', () => {
    beforeAll(async () => {
      await boot();
    }, 60_000);
    afterAll(shutdown);

    it('embeds the CV and GitHub chunks and records the embedded CV', async () => {
      const { candidateId, cvId } = await seed();
      const expected = chunkCandidate(CV_TEXT, SNAPSHOT);
      expect(expected.map((c) => c.source)).toEqual(['cv', 'github', 'github']);

      await worker.handle({ candidateId, cvDocumentId: cvId });

      const rows = await chunkRows(candidateId);
      expect(rows.map((r) => [r.chunk_index, r.source, r.text])).toEqual(
        expected.map((c, i) => [i, c.source, c.text]),
      );
      expect(rows.every((r) => r.model === EMBEDDING_MODEL)).toBe(true);
      expect(rows.every((r) => r.cv_document_id === cvId)).toBe(true);
      expect(await embeddedId(candidateId)).toBe(cvId);
      // One request carrying exactly the chunk texts, in order.
      expect(capture.bodies).toHaveLength(1);
      expect(capture.bodies[0].input).toEqual(expected.map((c) => c.text));
      expect(capture.bodies[0].model).toBe(EMBEDDING_MODEL);
      // Each stored vector belongs to its own chunk text.
      for (const row of rows) {
        const stored = JSON.parse(row.embedding) as number[];
        const wanted = fakeEmbedding(row.text);
        expect(stored).toHaveLength(wanted.length);
        for (let i = 0; i < wanted.length; i++) {
          expect(stored[i]).toBeCloseTo(wanted[i], 5);
        }
      }
    });

    it('runs from the queue via enqueueEmbed', async () => {
      const { candidateId, cvId } = await seed();

      await moduleRef!.get(JobsService).enqueueEmbed(candidateId, cvId);

      await waitFor(
        () => embeddedId(candidateId),
        (id) => id === cvId,
      );
      expect((await chunkRows(candidateId)).length).toBeGreaterThan(0);
    });

    it('embeds only the CV when there is no usable GitHub snapshot', async () => {
      const none = await seed({ snapshot: null });
      const failed = await seed({
        snapshot: { ...SNAPSHOT, status: 'unavailable', repos: [] },
      });

      await worker.handle({
        candidateId: none.candidateId,
        cvDocumentId: none.cvId,
      });
      await worker.handle({
        candidateId: failed.candidateId,
        cvDocumentId: failed.cvId,
      });

      for (const { candidateId } of [none, failed]) {
        expect((await chunkRows(candidateId)).map((r) => r.source)).toEqual([
          'cv',
        ]);
      }
    });

    it('replaces the chunks of an older CV', async () => {
      const { candidateId, cvId } = await seed({ cvText: 'old kubernetes cv' });
      await worker.handle({ candidateId, cvDocumentId: cvId });
      const newCvId = await addCv(candidateId, 'new react cv', 5);
      await candidates.saveParsedProfile(candidateId, newCvId, PROFILE, null);

      await worker.handle({ candidateId, cvDocumentId: newCvId });

      const rows = await chunkRows(candidateId);
      expect(rows.map((r) => r.text)).toEqual(['new react cv']);
      expect(rows[0].cv_document_id).toBe(newCvId);
      expect(await embeddedId(candidateId)).toBe(newCvId);
    });

    it('skips a candidate that is not parsed yet', async () => {
      const { candidateId, cvId } = await seed({ parsed: false });

      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect(capture.bodies).toHaveLength(0);
      expect(await chunkRows(candidateId)).toEqual([]);
      expect(await embeddedId(candidateId)).toBeNull();
    });

    it('skips a job for an unknown candidate', async () => {
      await worker.handle({
        candidateId: randomUUID(),
        cvDocumentId: randomUUID(),
      });

      expect(capture.bodies).toHaveLength(0);
    });

    it('skips a stale job when the parsed CV has changed', async () => {
      const { candidateId, cvId } = await seed();
      const newCvId = await addCv(candidateId, 'newer cv', 5);
      await candidates.saveParsedProfile(candidateId, newCvId, PROFILE, null);

      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect(capture.bodies).toHaveLength(0);
      expect(await chunkRows(candidateId)).toEqual([]);
      expect(await embeddedId(candidateId)).toBeNull();
    });

    it('does not embed again for an already embedded CV', async () => {
      const { candidateId, cvId } = await seed();

      await worker.handle({ candidateId, cvDocumentId: cvId });
      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect(capture.bodies).toHaveLength(1);
    });

    it('drops the result when another CV is parsed while embedding is in flight', async () => {
      const { candidateId, cvId } = await seed();
      const newCvId = await addCv(candidateId, 'newer cv', 5);
      server.use(
        openaiEmbeddingsHandler({
          before: async () => {
            await candidates.saveParsedProfile(
              candidateId,
              newCvId,
              PROFILE,
              null,
            );
          },
        }),
      );

      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect(await chunkRows(candidateId)).toEqual([]);
      expect(await embeddedId(candidateId)).toBeNull();
      // The newer CV is still in the backlog for its own job.
      expect(await candidates.findEmbedBacklog()).toContainEqual({
        candidateId,
        cvDocumentId: newCvId,
      });
    });

    it('throws on an embeddings error and writes nothing, keeping old chunks', async () => {
      const { candidateId, cvId } = await seed({
        cvText: 'old cv',
        snapshot: null,
      });
      await worker.handle({ candidateId, cvDocumentId: cvId });
      const newCvId = await addCv(candidateId, 'new cv', 5);
      await candidates.saveParsedProfile(candidateId, newCvId, PROFILE, null);
      server.use(openaiEmbeddingsErrorHandler(500));

      await expect(
        worker.handle({ candidateId, cvDocumentId: newCvId }),
      ).rejects.toThrow();

      expect((await chunkRows(candidateId)).map((r) => r.text)).toEqual([
        'old cv',
      ]);
      expect(await embeddedId(candidateId)).toBe(cvId);
    });

    it('marks a candidate with nothing to embed without calling OpenAI', async () => {
      const { candidateId, cvId } = await seed({
        cvText: ' \n\t\n',
        snapshot: null,
      });
      await chunks.replaceForCandidate(
        candidateId,
        cvId,
        [{ source: 'cv', text: 'stale', embedding: fakeEmbedding('stale') }],
        'm',
      );

      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect(capture.bodies).toHaveLength(0);
      expect(await chunkRows(candidateId)).toEqual([]);
      expect(await embeddedId(candidateId)).toBe(cvId);
      expect(
        (await candidates.findEmbedBacklog()).map((b) => b.candidateId),
      ).not.toContain(candidateId);
    });

    it('embeds GitHub chunks alone when the CV text is blank', async () => {
      const { candidateId, cvId } = await seed({ cvText: '  ' });

      await worker.handle({ candidateId, cvDocumentId: cvId });

      expect((await chunkRows(candidateId)).map((r) => r.source)).toEqual([
        'github',
        'github',
      ]);
    });
  });

  describe('startup sweep', () => {
    afterEach(shutdown);

    it('embeds parsed candidates whose chunks are missing', async () => {
      // No JobsModule is running here: seed first, then boot. Unparsed
      // leftovers of earlier tests would be re-parsed (an unmocked OpenAI
      // call), so settle them first.
      await testDb.pool.query(
        "UPDATE candidates SET parse_status = 'failed' WHERE parse_status IN ('pending', 'parsing')",
      );
      const missing = await seed();

      await boot();

      await waitFor(
        () => embeddedId(missing.candidateId),
        (id) => id === missing.cvId,
      );
      expect((await chunkRows(missing.candidateId)).length).toBeGreaterThan(0);
    });
  });
});
