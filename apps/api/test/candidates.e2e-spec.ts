import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv, applyWithCvBytes, fixtureBytes } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import { waitForEmbedded } from './embed.util.js';
import {
  captureOpenaiEmbeddingRequests,
  openaiEmbeddingsErrorHandler,
} from './msw/openai.handlers.js';
import { server } from './msw/server.js';
import { waitForParseStatus } from './parse.util.js';
import { textPdf } from './pdf.util.js';
import { SEARCH_MIN_SIMILARITY } from '../src/candidates/search/search.constants.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Candidates (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // The fake embedding model scores keyword overlap, so a short query
    // against a CV-sized chunk lands far below the production threshold
    // (0.3, tuned for real embeddings). Lower it; "no match" stays at ~0.
    testApp = await createTestApp({
      overrides: (builder) =>
        builder.overrideProvider(SEARCH_MIN_SIMILARITY).useValue(0.05),
    });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  async function authenticatedAgent(): Promise<
    ReturnType<typeof request.agent>
  > {
    const email = uniqueEmail();
    const password = 'password123';
    const agent = request.agent(testApp.app.getHttpServer());

    await agent.post('/auth/register').send({ email, password }).expect(201);
    await agent.post('/auth/login').send({ email, password }).expect(201);

    return agent;
  }

  async function createVacancyWithToken(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    overrides: { title?: string; requirements?: string } = {},
  ): Promise<{ id: string; applyToken: string }> {
    const res = await agent
      .post('/vacancies')
      .send({
        title: overrides.title ?? 'Senior Backend Engineer',
        requirements: overrides.requirements ?? '5+ years Node.js, PostgreSQL',
      })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  function applicationPayload(overrides: Record<string, string> = {}) {
    return {
      name: 'Jane Applicant',
      email: uniqueEmail(),
      ...overrides,
    };
  }

  async function applyToVacancy(
    applyToken: string,
    overrides: Record<string, string> = {},
  ): Promise<{
    name: string;
    email: string;
  }> {
    const payload = applicationPayload(overrides);
    await applyWithCv(testApp.app, applyToken, payload).expect(201);
    return payload;
  }

  async function findCandidateId(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    email: string,
  ): Promise<string> {
    const res = await agent.get('/candidates').expect(200);
    const match = (res.body as { id: string; email: string }[]).find(
      (c) => c.email === email.toLowerCase(),
    );
    if (!match) throw new Error('candidate not found in list');
    return match.id;
  }

  describe('GET /candidates', () => {
    it("lists a candidate who only applied to another recruiter's vacancy", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);

      const recruiterB = await authenticatedAgent();
      const res = await recruiterB.get('/candidates').expect(200);

      const emails = (res.body as { email: string }[]).map((c) => c.email);
      expect(emails).toContain(applicant.email.toLowerCase());
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer()).get('/candidates').expect(401);
    });
  });

  describe('GET /candidates/:id', () => {
    it("returns the candidate's profile without exposing applications", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);

      const recruiterB = await authenticatedAgent();
      const candidateId = await findCandidateId(recruiterB, applicant.email);

      const res = await recruiterB
        .get(`/candidates/${candidateId}`)
        .expect(200);

      expect(res.body).toMatchObject({
        name: applicant.name,
        email: applicant.email.toLowerCase(),
      });
      expect(res.body.applications).toBeUndefined();
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/candidates/${randomUUID()}`).expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);

      await request(testApp.app.getHttpServer())
        .get(`/candidates/${candidateId}`)
        .expect(401);
    });
  });

  describe('GET /candidates/:id/cv', () => {
    const binaryParser = (
      res: request.Response,
      cb: (err: Error | null, body: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    async function applyAndGetId(
      agent: Awaited<ReturnType<typeof authenticatedAgent>>,
      applyToken: string,
      email: string,
      fixture = 'cv-text.pdf',
      uploadName?: string,
    ): Promise<string> {
      await applyWithCv(
        testApp.app,
        applyToken,
        { name: 'Jane Applicant', email },
        fixture,
        uploadName,
      ).expect(201);
      return findCandidateId(agent, email);
    }

    it('returns the uploaded PDF inline with safe headers', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(agent);
      const id = await applyAndGetId(agent, applyToken, uniqueEmail());

      const res = await agent
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('inline;');
      expect(res.headers['content-disposition']).toContain(
        'filename="cv-text.pdf"',
      );
      expect(res.headers['content-length']).toBe(
        String(fixtureBytes('cv-text.pdf').length),
      );
      expect((res.body as Buffer).equals(fixtureBytes('cv-text.pdf'))).toBe(
        true,
      );
    });

    it('returns the newer CV after a later application', async () => {
      const agent = await authenticatedAgent();
      const first = await createVacancyWithToken(agent);
      const second = await createVacancyWithToken(agent);
      const email = uniqueEmail();
      const id = await applyAndGetId(agent, first.applyToken, email);
      await applyAndGetId(agent, second.applyToken, email, 'cv-text-2.pdf');

      const res = await agent
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect((res.body as Buffer).equals(fixtureBytes('cv-text-2.pdf'))).toBe(
        true,
      );
    });

    it("lets another recruiter download the candidate's CV", async () => {
      const owner = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(owner);
      const email = uniqueEmail();
      await applyAndGetId(owner, applyToken, email);

      const other = await authenticatedAgent();
      const id = await findCandidateId(other, email);
      const res = await other
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect((res.body as Buffer).equals(fixtureBytes('cv-text.pdf'))).toBe(
        true,
      );
    });

    it('encodes a non-ASCII filename per RFC 5987', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(agent);
      const id = await applyAndGetId(
        agent,
        applyToken,
        uniqueEmail(),
        'cv-text.pdf',
        'résumé.pdf',
      );

      const res = await agent.get(`/candidates/${id}/cv`).expect(200);

      expect(res.headers['content-disposition']).toContain(
        "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
      );
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/candidates/${randomUUID()}/cv`).expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid/cv').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/candidates/${randomUUID()}/cv`)
        .expect(401);
    });
  });

  describe('GET /candidates/:id/applications', () => {
    it("lists the candidate's applications on the recruiter's own vacancies only, newest first", async () => {
      const recruiterA = await authenticatedAgent();
      const vacancyA = await createVacancyWithToken(recruiterA, {
        title: 'Role A',
      });
      const applicant = await applyToVacancy(vacancyA.applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);
      const vacancyB = await createVacancyWithToken(recruiterA, {
        title: 'Role B',
      });
      await recruiterA
        .post(`/vacancies/${vacancyB.id}/applications`)
        .send({ candidateId })
        .expect(201);
      const closed = await createVacancyWithToken(recruiterA, {
        title: 'Role closed',
      });
      await recruiterA
        .post(`/vacancies/${closed.id}/applications`)
        .send({ candidateId })
        .expect(201);
      await recruiterA
        .patch(`/vacancies/${closed.id}`)
        .send({ status: 'closed' })
        .expect(200);

      // a second recruiter puts the same candidate on their own vacancy
      const recruiterB = await authenticatedAgent();
      const foreignVacancy = await createVacancyWithToken(recruiterB, {
        title: 'Foreign role',
      });
      await recruiterB
        .post(`/vacancies/${foreignVacancy.id}/applications`)
        .send({ candidateId })
        .expect(201);

      const mine = await recruiterA
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);

      expect(
        (mine.body as { vacancyTitle: string }[]).map((a) => a.vacancyTitle),
      ).toEqual(['Role closed', 'Role B', 'Role A']);
      expect(mine.body[0]).toMatchObject({
        vacancyId: closed.id,
        vacancyStatus: 'closed',
        stage: 'applied',
        source: 'added',
        createdAt: expect.any(String),
        score: {
          status: expect.any(String),
          error: null,
          stale: false,
          waitingForParse: expect.any(Boolean),
        },
      });
      expect(mine.body[1]).toMatchObject({
        vacancyId: vacancyB.id,
        vacancyStatus: 'open',
        source: 'added',
      });
      expect(mine.body[2]).toMatchObject({
        vacancyId: vacancyA.id,
        vacancyTitle: 'Role A',
        vacancyStatus: 'open',
        source: 'applied',
      });
      expect(JSON.stringify(mine.body)).not.toContain(foreignVacancy.id);

      const theirs = await recruiterB
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);
      expect(theirs.body).toHaveLength(1);
      expect(theirs.body[0]).toMatchObject({
        vacancyId: foreignVacancy.id,
        vacancyTitle: 'Foreign role',
        source: 'added',
      });
    });

    it("returns an empty array when the candidate is not on any of the recruiter's vacancies", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);

      const recruiterB = await authenticatedAgent();
      const res = await recruiterB
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      const res = await agent
        .get(`/candidates/${randomUUID()}/applications`)
        .expect(404);

      expect(res.body.message).toBe('Candidate not found');
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid/applications').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/candidates/${randomUUID()}/applications`)
        .expect(401);
    });
  });

  describe('POST /candidates/search', () => {
    const K8S_CV = [
      'Alex Kube - Platform Engineer',
      'Operated Kubernetes clusters on AWS EKS for five years.',
      'Wrote Terraform modules for networking, IAM and clusters.',
      'Helm charts, ArgoCD deployments, Prometheus and Grafana monitoring.',
    ];
    const REACT_CV = [
      'Rita Reactor - Frontend Developer',
      'Built React and TypeScript single page applications.',
      'Unit tests with Jest and Testing Library, Storybook component library.',
      'Accessibility reviews and design system maintenance.',
    ];
    const DATA_CV = [
      'Dana Datum - Data Engineer',
      'Python pandas and Spark pipelines orchestrated with Airflow.',
      'Snowflake warehouse modelling with dbt.',
    ];

    let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
    let cookie: string[];
    let vacancy: { id: string; applyToken: string };
    let k8sId: string;
    let reactId: string;
    let dataId: string;

    async function applyPdf(
      applyToken: string,
      email: string,
      lines: string[],
    ): Promise<string> {
      await applyWithCvBytes(
        testApp.app,
        applyToken,
        { name: 'Search Candidate', email },
        textPdf(lines),
      ).expect(201);
      const id = await findCandidateId(agent, email);
      await waitForParseStatus(testApp.app, cookie, id, 'parsed');
      await waitForEmbedded(testApp.app, id);
      return id;
    }

    function search(query: unknown) {
      return agent.post('/candidates/search').send({ query });
    }

    interface SearchBody {
      candidate: { id: string };
      similarity: number;
      snippets: { source: string; text: string; similarity: number }[];
    }

    beforeAll(async () => {
      const email = uniqueEmail();
      const password = 'password123';
      agent = request.agent(testApp.app.getHttpServer());
      await agent.post('/auth/register').send({ email, password }).expect(201);
      const login = await agent
        .post('/auth/login')
        .send({ email, password })
        .expect(201);
      cookie = login.headers['set-cookie'] as unknown as string[];

      vacancy = await createVacancyWithToken(agent);
      k8sId = await applyPdf(vacancy.applyToken, uniqueEmail(), K8S_CV);
      reactId = await applyPdf(vacancy.applyToken, uniqueEmail(), REACT_CV);
      dataId = await applyPdf(vacancy.applyToken, uniqueEmail(), DATA_CV);
    }, 60_000);

    it('ranks the matching candidate first, with a matching snippet and the full candidate', async () => {
      const res = await search('kubernetes terraform').expect(200);
      const body = res.body as SearchBody[];

      expect(body[0].candidate.id).toBe(k8sId);
      for (const other of body.slice(1)) {
        expect(body[0].similarity).toBeGreaterThanOrEqual(other.similarity);
      }
      expect(body.map((r) => r.candidate.id)).not.toContain(reactId);
      expect(body.map((r) => r.candidate.id)).not.toContain(dataId);

      expect(body[0].similarity).toBeGreaterThan(0);
      expect(body[0].similarity).toBeLessThanOrEqual(1);
      expect(body[0].snippets.length).toBeGreaterThanOrEqual(1);
      expect(body[0].snippets.length).toBeLessThanOrEqual(3);
      expect(body[0].snippets[0]).toEqual({
        source: 'cv',
        text: expect.stringContaining('Kubernetes'),
        similarity: body[0].similarity,
      });
      // rounded to 3 decimals
      expect(Math.round(body[0].similarity * 1000) / 1000).toBe(
        body[0].similarity,
      );

      // the candidate is the same full CandidateResponse GET /candidates/:id returns
      const detail = await agent.get(`/candidates/${k8sId}`).expect(200);
      expect(body[0].candidate).toEqual(detail.body);
    });

    it('finds a different candidate for a different query', async () => {
      const res = await search('react typescript jest').expect(200);

      expect((res.body as SearchBody[])[0].candidate.id).toBe(reactId);
    });

    it('is visible to any recruiter (shared pool)', async () => {
      const other = await authenticatedAgent();

      const res = await other
        .post('/candidates/search')
        .send({ query: 'airflow snowflake dbt' })
        .expect(200);

      expect((res.body as SearchBody[])[0].candidate.id).toBe(dataId);
    });

    it('returns an empty list when nothing matches', async () => {
      const res = await search('zzzz qqqq').expect(200);

      expect(res.body).toEqual([]);
    });

    it('embeds the trimmed query with exactly one embeddings request', async () => {
      const capture = captureOpenaiEmbeddingRequests();
      server.events.on('request:start', capture.listener);
      try {
        await search('  kubernetes terraform \n').expect(200);
      } finally {
        server.events.removeListener('request:start', capture.listener);
      }

      expect(capture.bodies).toHaveLength(1);
      expect(capture.bodies[0].input).toEqual(['kubernetes terraform']);
    });

    it.each([
      ['a missing query', undefined],
      ['an empty query', ''],
      ['a whitespace-only query', '   \t\n '],
      ['a query over 500 characters', 'a'.repeat(501)],
      ['a numeric query', 42],
      ['an array query', ['kubernetes']],
    ])('rejects %s', async (_label, query) => {
      const capture = captureOpenaiEmbeddingRequests();
      server.events.on('request:start', capture.listener);
      try {
        await search(query).expect(400);
      } finally {
        server.events.removeListener('request:start', capture.listener);
      }
      expect(capture.bodies).toHaveLength(0);
    });

    it('accepts a query of exactly 500 characters', async () => {
      await search('a'.repeat(500)).expect(200);
    });

    it('rejects unknown body fields', async () => {
      await agent
        .post('/candidates/search')
        .send({ query: 'kubernetes', limit: 5 })
        .expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .post('/candidates/search')
        .send({ query: 'kubernetes' })
        .expect(401);
    });

    it('returns 503 when the embeddings service fails', async () => {
      server.use(openaiEmbeddingsErrorHandler(500));

      const res = await search('kubernetes terraform').expect(503);

      expect(res.body.message).toBe('Search is temporarily unavailable');
    });

    it("replaces a candidate's chunks when a newer CV is embedded", async () => {
      const email = uniqueEmail();
      const id = await applyPdf(vacancy.applyToken, email, [
        'Old Timer',
        'Fortran and COBOL mainframe batch programming.',
      ]);
      const before = await search('fortran cobol mainframe').expect(200);
      const beforeHit = (before.body as SearchBody[]).find(
        (r) => r.candidate.id === id,
      );
      expect(beforeHit?.snippets[0].text).toContain('COBOL');

      // re-apply with the same email and a different CV, on another vacancy
      const second = await createVacancyWithToken(agent);
      await applyWithCvBytes(
        testApp.app,
        second.applyToken,
        { name: 'Search Candidate', email },
        textPdf(['Old Timer', 'Haskell and OCaml functional programming.']),
      ).expect(201);
      const latest = await agent.get(`/candidates/${id}`).expect(200);
      const newCvId = (latest.body as { cv: { id: string } }).cv.id;
      await waitForParseStatus(testApp.app, cookie, id, 'parsed');
      await waitForEmbedded(testApp.app, id, { cvDocumentId: newCvId });

      const old = await search('fortran cobol mainframe').expect(200);
      expect(
        (old.body as SearchBody[]).map((r) => r.candidate.id),
      ).not.toContain(id);
      const fresh = await search('haskell ocaml functional').expect(200);
      const freshHit = (fresh.body as SearchBody[]).find(
        (r) => r.candidate.id === id,
      );
      expect(freshHit?.snippets[0].text).toContain('Haskell');
    });
  });
});
