import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv, applyWithCvBytes } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import { waitForEmbedded } from './embed.util.js';
import {
  captureOpenaiEmbeddingRequests,
  captureOpenaiRequests,
  openaiCriteriaHandler,
  openaiEmbeddingsErrorHandler,
  openaiErrorHandler,
  openaiProfileHandler,
  type MockCriterion,
} from './msw/openai.handlers.js';
import { DEFAULT_MOCK_PROFILE, server } from './msw/server.js';
import { waitForParseStatus } from './parse.util.js';
import { textPdf } from './pdf.util.js';
import { waitForScoreStatus } from './score.util.js';
import { SEARCH_MIN_SIMILARITY } from '../src/candidates/search/search.constants.js';
import { MATCH_FLOOR_TOKEN } from '../src/vacancies/matches/matches.constants.js';
import { VACANCY_CRITERIA_SCHEMA_NAME } from '../src/llm/vacancy-criteria.schema.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Vacancies (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // The fake embedding model scores keyword overlap, so a short criterion or
    // query against a CV-sized chunk lands far below the production thresholds
    // (0.3, tuned for real embeddings). Lower them; "no match" stays at ~0.
    testApp = await createTestApp({
      overrides: (builder) =>
        builder
          .overrideProvider(MATCH_FLOOR_TOKEN)
          .useValue(0.05)
          .overrideProvider(SEARCH_MIN_SIMILARITY)
          .useValue(0.05),
    });
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  // The cookie is for the polling helpers, which take it instead of an agent.
  async function authenticatedSession(): Promise<{
    agent: ReturnType<typeof request.agent>;
    cookie: string[];
  }> {
    const email = uniqueEmail();
    const password = 'password123';
    const agent = request.agent(testApp.app.getHttpServer());

    await agent.post('/auth/register').send({ email, password }).expect(201);
    const login = await agent
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    return {
      agent,
      cookie: login.headers['set-cookie'] as unknown as string[],
    };
  }

  async function authenticatedAgent(): Promise<
    ReturnType<typeof request.agent>
  > {
    const { agent } = await authenticatedSession();
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

  async function createVacancy(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    overrides: { title?: string; requirements?: string } = {},
  ): Promise<string> {
    const { id } = await createVacancyWithToken(agent, overrides);
    return id;
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
  ): Promise<{ name: string; email: string }> {
    const payload = applicationPayload(overrides);
    await applyWithCv(testApp.app, applyToken, payload).expect(201);
    return { name: payload.name, email: payload.email };
  }

  describe('POST /vacancies', () => {
    it('creates a vacancy owned by the authenticated recruiter', async () => {
      const agent = await authenticatedAgent();

      const res = await agent
        .post('/vacancies')
        .send({
          title: 'Senior Backend Engineer',
          requirements: '5+ years Node.js, PostgreSQL',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
        status: 'open',
      });
      expect(res.body.id).toBeDefined();
      expect(typeof res.body.applyToken).toBe('string');
      expect(res.body.applyToken.length).toBeGreaterThan(0);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .post('/vacancies')
        .send({ title: 'Title', requirements: 'Requirements' })
        .expect(401);
    });

    it('rejects a missing title', async () => {
      const agent = await authenticatedAgent();

      await agent
        .post('/vacancies')
        .send({ requirements: 'Requirements' })
        .expect(400);
    });

    it('rejects a missing requirements field', async () => {
      const agent = await authenticatedAgent();

      await agent.post('/vacancies').send({ title: 'Title' }).expect(400);
    });
  });

  describe('PATCH /vacancies/:id', () => {
    it('updates fields on a vacancy owned by the authenticated recruiter', async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent);

      const res = await agent
        .patch(`/vacancies/${id}`)
        .send({ title: 'Staff Backend Engineer' })
        .expect(200);

      expect(res.body).toMatchObject({
        id,
        title: 'Staff Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
        status: 'open',
      });
    });

    it('closes a vacancy', async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent);

      const res = await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'closed' })
        .expect(200);

      expect(res.body.status).toBe('closed');
    });

    it('rejects a non-owner with 404', async () => {
      const owner = await authenticatedAgent();
      const id = await createVacancy(owner);
      const otherRecruiter = await authenticatedAgent();

      await otherRecruiter
        .patch(`/vacancies/${id}`)
        .send({ title: 'Hijacked' })
        .expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent
        .patch(`/vacancies/${randomUUID()}`)
        .send({ title: 'Title' })
        .expect(404);
    });

    it('rejects an invalid status value', async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent);

      await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'archived' })
        .expect(400);
    });
  });

  describe('GET /vacancies', () => {
    it("returns only the authenticated recruiter's vacancies", async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent, { title: 'Mine' });
      const other = await authenticatedAgent();
      await createVacancy(other, { title: 'Not mine' });

      const res = await agent.get('/vacancies').expect(200);

      const ids = (res.body as { id: string }[]).map((v) => v.id);
      expect(ids).toContain(id);
      expect(
        res.body.every((v: { title: string }) => v.title !== 'Not mine'),
      ).toBe(true);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer()).get('/vacancies').expect(401);
    });
  });

  describe('GET /vacancies/:id', () => {
    it('returns a vacancy owned by the authenticated recruiter', async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent);

      const res = await agent.get(`/vacancies/${id}`).expect(200);

      expect(res.body).toMatchObject({
        id,
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
        status: 'open',
      });
    });

    it('rejects a non-owner with 404', async () => {
      const owner = await authenticatedAgent();
      const id = await createVacancy(owner);
      const otherRecruiter = await authenticatedAgent();

      await otherRecruiter.get(`/vacancies/${id}`).expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/vacancies/${randomUUID()}`).expect(404);
    });

    it('rejects a request with no session cookie', async () => {
      const agent = await authenticatedAgent();
      const id = await createVacancy(agent);

      await request(testApp.app.getHttpServer())
        .get(`/vacancies/${id}`)
        .expect(401);
    });
  });

  describe('GET /vacancies/:id/applications', () => {
    it("returns applications with candidate info for the owner's vacancy", async () => {
      const agent = await authenticatedAgent();
      const { id, applyToken } = await createVacancyWithToken(agent);
      const { applyToken: otherToken } = await createVacancyWithToken(agent, {
        title: 'Other role',
      });

      const first = await applyToVacancy(applyToken);
      const second = await applyToVacancy(applyToken);
      const other = await applyToVacancy(otherToken);

      const res = await agent.get(`/vacancies/${id}/applications`).expect(200);

      expect(res.body).toHaveLength(2);
      const byEmail = new Map(
        (res.body as { candidate: { email: string } }[]).map((a) => [
          a.candidate.email,
          a,
        ]),
      );
      expect(byEmail.has(other.email.toLowerCase())).toBe(false);

      const firstApp = byEmail.get(first.email.toLowerCase());
      expect(firstApp).toMatchObject({
        stage: 'applied',
        source: 'applied',
        candidate: { name: first.name, email: first.email.toLowerCase() },
        score: {
          status: 'pending',
          error: null,
          waitingForParse: expect.any(Boolean),
          stale: false,
          result: null,
        },
      });
      expect(firstApp?.candidate).not.toHaveProperty('parsedCvDocumentId');

      const secondApp = byEmail.get(second.email.toLowerCase());
      expect(secondApp).toMatchObject({
        stage: 'applied',
        candidate: { name: second.name, email: second.email.toLowerCase() },
      });
    });

    it('returns an empty array for a vacancy with no applications', async () => {
      const agent = await authenticatedAgent();
      const { id } = await createVacancyWithToken(agent);

      const res = await agent.get(`/vacancies/${id}/applications`).expect(200);

      expect(res.body).toEqual([]);
    });

    it('rejects a non-owner with 404', async () => {
      const owner = await authenticatedAgent();
      const { id } = await createVacancyWithToken(owner);
      const otherRecruiter = await authenticatedAgent();

      await otherRecruiter.get(`/vacancies/${id}/applications`).expect(404);
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/vacancies/${randomUUID()}/applications`).expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/vacancies/not-a-uuid/applications').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      const agent = await authenticatedAgent();
      const { id } = await createVacancyWithToken(agent);

      await request(testApp.app.getHttpServer())
        .get(`/vacancies/${id}/applications`)
        .expect(401);
    });
  });

  describe('POST /vacancies/:id/applications', () => {
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

    /** Applies a new candidate to a fresh vacancy; returns the ids. */
    async function candidateOnVacancy(
      agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    ) {
      const vacancy = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(vacancy.applyToken);
      const candidateId = await findCandidateId(agent, applicant.email);
      return { vacancy, candidateId };
    }

    it('adds a parsed pool candidate: 201 with source "added", then scores it with quotes', async () => {
      const { agent, cookie } = await authenticatedSession();
      const { vacancy: vacancyA, candidateId } =
        await candidateOnVacancy(agent);
      await waitForParseStatus(testApp.app, cookie, candidateId, 'parsed');
      const vacancyB = await createVacancyWithToken(agent, {
        title: 'Platform Engineer',
      });

      const res = await agent
        .post(`/vacancies/${vacancyB.id}/applications`)
        .send({ candidateId })
        .expect(201);

      expect(res.body).toMatchObject({
        vacancyId: vacancyB.id,
        candidateId,
        stage: 'applied',
        source: 'added',
        candidate: { id: candidateId, parseStatus: 'parsed' },
        score: { error: null, waitingForParse: false },
      });
      // scoring runs in the background: depending on timing the response
      // already shows it started (or even finished)
      expect(['pending', 'scoring', 'scored']).toContain(res.body.score.status);
      expect(res.body.candidate).not.toHaveProperty('parsedCvDocumentId');
      const applicationId = res.body.id as string;

      const score = await waitForScoreStatus(
        testApp.app,
        cookie,
        vacancyB.id,
        applicationId,
        'scored',
      );
      expect(score.result!.criteria.length).toBeGreaterThan(0);
      for (const criterion of score.result!.criteria) {
        expect(criterion.quotes.length).toBeGreaterThan(0);
      }

      const list = await agent
        .get(`/vacancies/${vacancyB.id}/applications`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        id: applicationId,
        source: 'added',
        candidate: { id: candidateId },
        score: { status: 'scored' },
      });

      // the original application is untouched
      const original = await agent
        .get(`/vacancies/${vacancyA.id}/applications`)
        .expect(200);
      expect(original.body).toHaveLength(1);
      expect(original.body[0].source).toBe('applied');
    });

    it('waits for a pending parse, then scores the added candidate', async () => {
      const { agent, cookie } = await authenticatedSession();
      const vacancyA = await createVacancyWithToken(agent);
      const vacancyB = await createVacancyWithToken(agent, {
        title: 'Platform Engineer',
      });

      // hold the parse so the candidate is still unparsed when added
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let started!: () => void;
      const parseStarted = new Promise<void>((resolve) => (started = resolve));
      server.use(
        openaiProfileHandler(DEFAULT_MOCK_PROFILE, {
          before: async () => {
            started();
            await gate;
          },
        }),
      );

      try {
        const applicant = await applyToVacancy(vacancyA.applyToken);
        const candidateId = await findCandidateId(agent, applicant.email);
        await parseStarted;

        const res = await agent
          .post(`/vacancies/${vacancyB.id}/applications`)
          .send({ candidateId })
          .expect(201);

        expect(res.body.source).toBe('added');
        expect(res.body.candidate.parseStatus).toBe('parsing');
        expect(res.body.score).toMatchObject({
          status: 'pending',
          waitingForParse: true,
        });
        const applicationId = res.body.id as string;

        // still waiting while the parse is held
        const waiting = await agent
          .get(`/vacancies/${vacancyB.id}/applications`)
          .expect(200);
        expect(waiting.body[0].score).toMatchObject({
          status: 'pending',
          waitingForParse: true,
        });

        release();
        await waitForParseStatus(testApp.app, cookie, candidateId, 'parsed');
        const score = await waitForScoreStatus(
          testApp.app,
          cookie,
          vacancyB.id,
          applicationId,
          'scored',
        );
        expect(score.waitingForParse).toBe(false);
        expect(score.result!.criteria.length).toBeGreaterThan(0);
      } finally {
        release();
      }
    });

    it('answers 409 for a candidate already on the vacancy, applied or added', async () => {
      const agent = await authenticatedAgent();
      const { vacancy, candidateId } = await candidateOnVacancy(agent);
      const other = await createVacancyWithToken(agent);

      const applied = await agent
        .post(`/vacancies/${vacancy.id}/applications`)
        .send({ candidateId })
        .expect(409);
      expect(applied.body.message).toBe('Candidate is already on this vacancy');

      await agent
        .post(`/vacancies/${other.id}/applications`)
        .send({ candidateId })
        .expect(201);
      const added = await agent
        .post(`/vacancies/${other.id}/applications`)
        .send({ candidateId })
        .expect(409);
      expect(added.body.message).toBe('Candidate is already on this vacancy');

      const list = await agent
        .get(`/vacancies/${other.id}/applications`)
        .expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('answers 201 once and 409 for a concurrent duplicate add, never 500', async () => {
      const agent = await authenticatedAgent();
      const { candidateId } = await candidateOnVacancy(agent);
      const target = await createVacancyWithToken(agent);

      const responses = await Promise.all(
        [1, 2].map(() =>
          agent
            .post(`/vacancies/${target.id}/applications`)
            .send({ candidateId }),
        ),
      );

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      const conflict = responses.find((r) => r.status === 409)!;
      expect(conflict.body.message).toBe(
        'Candidate is already on this vacancy',
      );
      const list = await agent
        .get(`/vacancies/${target.id}/applications`)
        .expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('answers 409 for a closed vacancy', async () => {
      const agent = await authenticatedAgent();
      const { candidateId } = await candidateOnVacancy(agent);
      const closed = await createVacancyWithToken(agent);
      await agent
        .patch(`/vacancies/${closed.id}`)
        .send({ status: 'closed' })
        .expect(200);

      const res = await agent
        .post(`/vacancies/${closed.id}/applications`)
        .send({ candidateId })
        .expect(409);

      expect(res.body.message).toBe('Vacancy is closed');
      const list = await agent
        .get(`/vacancies/${closed.id}/applications`)
        .expect(200);
      expect(list.body).toEqual([]);
    });

    it("answers 404 for another recruiter's vacancy and an unknown vacancy", async () => {
      const owner = await authenticatedAgent();
      const { candidateId } = await candidateOnVacancy(owner);
      const ownerVacancy = await createVacancyWithToken(owner);
      const otherRecruiter = await authenticatedAgent();

      const foreign = await otherRecruiter
        .post(`/vacancies/${ownerVacancy.id}/applications`)
        .send({ candidateId })
        .expect(404);
      expect(foreign.body.message).toBe('Vacancy not found');
      const unknown = await owner
        .post(`/vacancies/${randomUUID()}/applications`)
        .send({ candidateId })
        .expect(404);
      expect(unknown.body.message).toBe('Vacancy not found');

      const list = await owner
        .get(`/vacancies/${ownerVacancy.id}/applications`)
        .expect(200);
      expect(list.body).toEqual([]);
    });

    it('answers 404 for an unknown candidate', async () => {
      const agent = await authenticatedAgent();
      const vacancy = await createVacancyWithToken(agent);

      const res = await agent
        .post(`/vacancies/${vacancy.id}/applications`)
        .send({ candidateId: randomUUID() })
        .expect(404);

      expect(res.body.message).toBe('Candidate not found');
    });

    it('rejects a malformed or missing candidateId and a malformed vacancy id', async () => {
      const agent = await authenticatedAgent();
      const vacancy = await createVacancyWithToken(agent);

      await agent
        .post(`/vacancies/${vacancy.id}/applications`)
        .send({ candidateId: 'not-a-uuid' })
        .expect(400);
      await agent
        .post(`/vacancies/${vacancy.id}/applications`)
        .send({})
        .expect(400);
      await agent
        .post('/vacancies/not-a-uuid/applications')
        .send({ candidateId: randomUUID() })
        .expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .post(`/vacancies/${randomUUID()}/applications`)
        .send({ candidateId: randomUUID() })
        .expect(401);
    });
  });
  describe('GET /vacancies/:id/matches', () => {
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
    // Airflow matches only the data candidate; Haskell matches nobody.
    const DEVOPS_CRITERIA: MockCriterion[] = [
      { text: 'Terraform', importance: 'must' },
      { text: 'Airflow', importance: 'nice' },
      { text: 'Kubernetes', importance: 'must' },
      { text: 'Haskell', importance: 'nice' },
    ];

    interface MatchBody {
      mode: string;
      matches: {
        candidate: { id: string };
        score: number;
        criteria: {
          criterionId: string;
          criterion: string;
          importance: string;
          similarity: number | null;
          matched: boolean;
        }[];
        snippets: {
          source: string;
          text: string;
          similarity: number;
          criterionId: string | null;
        }[];
      }[];
    }

    let agent: Awaited<ReturnType<typeof authenticatedAgent>>;
    let cookie: string[];
    let devopsId: string;
    let reactId: string;
    let dataId: string;

    async function applyPdf(
      applyToken: string,
      lines: string[],
    ): Promise<string> {
      const email = uniqueEmail();
      await applyWithCvBytes(
        testApp.app,
        applyToken,
        { name: 'Match Candidate', email },
        textPdf(lines),
      ).expect(201);
      const list = await agent.get('/candidates').expect(200);
      const id = (list.body as { id: string; email: string }[]).find(
        (c) => c.email === email,
      )!.id;
      await waitForParseStatus(testApp.app, cookie, id, 'parsed');
      await waitForEmbedded(testApp.app, id);
      return id;
    }

    /** A fresh open vacancy of the same recruiter, with no stored criteria. */
    async function newVacancy(): Promise<string> {
      return createVacancy(agent, {
        title: 'Platform Engineer',
        requirements: 'Kubernetes Terraform production',
      });
    }

    function matches(vacancyId: string, query = '') {
      return agent.get(`/vacancies/${vacancyId}/matches${query}`);
    }

    /** Runs `fn` and returns the OpenAI requests it caused. */
    async function captured(fn: () => Promise<unknown>) {
      const criteria = captureOpenaiRequests(VACANCY_CRITERIA_SCHEMA_NAME);
      const embeddings = captureOpenaiEmbeddingRequests();
      server.events.on('request:start', criteria.listener);
      server.events.on('request:start', embeddings.listener);
      try {
        await fn();
      } finally {
        server.events.removeListener('request:start', criteria.listener);
        server.events.removeListener('request:start', embeddings.listener);
      }
      return { criteria: criteria.bodies, embeddings: embeddings.bodies };
    }

    beforeAll(async () => {
      const session = await authenticatedSession();
      agent = session.agent;
      cookie = session.cookie;

      const vacancyA = await createVacancyWithToken(agent);
      devopsId = await applyPdf(vacancyA.applyToken, K8S_CV);
      reactId = await applyPdf(vacancyA.applyToken, REACT_CV);
      dataId = await applyPdf(vacancyA.applyToken, DATA_CV);

      // Let A's own criteria extraction and scoring finish, so they cannot
      // show up in the request captures of the tests below.
      const applications = await agent
        .get(`/vacancies/${vacancyA.id}/applications`)
        .expect(200);
      for (const application of applications.body as { id: string }[]) {
        await waitForScoreStatus(
          testApp.app,
          cookie,
          vacancyA.id,
          application.id,
          'scored',
        );
      }
    }, 60_000);

    it('ranks the matching candidate first, with criteria must-first, matched flags and a tagged snippet', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();

      const res = await matches(vacancyId).expect(200);
      const body = res.body as MatchBody;

      expect(body.mode).toBe('criteria');
      const ids = body.matches.map((m) => m.candidate.id);
      expect(ids[0]).toBe(devopsId);
      expect(ids).toContain(dataId);
      expect(ids).not.toContain(reactId);

      const [devops, data] = body.matches;
      expect(devops.score).toBeGreaterThan(data.score);
      expect(devops.score).toBeGreaterThan(0);
      expect(devops.score).toBeLessThanOrEqual(1);
      expect(Math.round(devops.score * 1000) / 1000).toBe(devops.score);

      // every criterion, must first (in extraction order), then nice
      expect(
        devops.criteria.map((c) => [c.criterion, c.importance, c.matched]),
      ).toEqual([
        ['Terraform', 'must', true],
        ['Kubernetes', 'must', true],
        ['Airflow', 'nice', false],
        ['Haskell', 'nice', false],
      ]);
      expect(devops.criteria.map((c) => c.criterionId)).toEqual([
        'c1',
        'c3',
        'c2',
        'c4',
      ]);
      for (const c of devops.criteria.filter((c) => c.matched)) {
        expect(c.similarity).toBeGreaterThanOrEqual(0.05);
      }
      expect(data.criteria.filter((c) => c.matched)).toEqual([
        expect.objectContaining({ criterion: 'Airflow', matched: true }),
      ]);

      expect(devops.snippets.length).toBeGreaterThanOrEqual(1);
      expect(devops.snippets.length).toBeLessThanOrEqual(3);
      const matchedIds = devops.criteria
        .filter((c) => c.matched)
        .map((c) => c.criterionId);
      expect(devops.snippets[0]).toEqual({
        source: 'cv',
        text: expect.stringContaining('Kubernetes'),
        similarity: expect.any(Number),
        criterionId: expect.stringMatching(/^c[13]$/),
      });
      for (const snippet of devops.snippets) {
        expect(matchedIds).toContain(snippet.criterionId);
      }

      // the candidate is the same full CandidateResponse GET /candidates/:id returns
      const detail = await agent.get(`/candidates/${devopsId}`).expect(200);
      expect(devops.candidate).toEqual(detail.body);
    });

    it('defaults to criteria mode and rejects an explicit unknown mode', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();

      const explicit = await matches(vacancyId, '?mode=criteria').expect(200);
      const implicit = await matches(vacancyId).expect(200);

      expect(explicit.body).toEqual(implicit.body);
      await matches(vacancyId, '?mode=fuzzy').expect(400);
      await matches(vacancyId, '?mode=').expect(400);
    });

    it('excludes a candidate that is already on the vacancy, any stage', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();
      const before = await matches(vacancyId).expect(200);
      expect(
        (before.body as MatchBody).matches.map((m) => m.candidate.id),
      ).toContain(devopsId);

      await agent
        .post(`/vacancies/${vacancyId}/applications`)
        .send({ candidateId: devopsId })
        .expect(201);

      const after = await matches(vacancyId).expect(200);
      const ids = (after.body as MatchBody).matches.map((m) => m.candidate.id);
      expect(ids).not.toContain(devopsId);
      expect(ids[0]).toBe(dataId);
    });

    it('returns whole_text matches without criteria or criterion ids', async () => {
      const vacancyId = await newVacancy();

      const requests = await captured(async () => {
        const res = await matches(vacancyId, '?mode=whole_text').expect(200);
        const body = res.body as MatchBody;

        expect(body.mode).toBe('whole_text');
        expect(body.matches[0].candidate.id).toBe(devopsId);
        expect(body.matches.map((m) => m.candidate.id)).not.toContain(reactId);
        for (const match of body.matches) {
          expect(match.criteria).toEqual([]);
          expect(match.snippets.length).toBeGreaterThanOrEqual(1);
          for (const snippet of match.snippets) {
            expect(snippet.criterionId).toBeNull();
          }
        }
        expect(body.matches[0].score).toBe(
          body.matches[0].snippets[0].similarity,
        );
        expect(body.matches[0].snippets[0].text).toContain('Kubernetes');
      });

      // whole_text never needs criteria: one embeddings request, no extraction
      expect(requests.criteria).toHaveLength(0);
      expect(requests.embeddings).toHaveLength(1);
      expect(requests.embeddings[0].input).toEqual([
        'Platform Engineer\nKubernetes Terraform production',
      ]);
    });

    it('extracts missing criteria once, stores them, and embeds all criteria in one request', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();

      const first = await captured(() => matches(vacancyId).expect(200));
      expect(first.criteria).toHaveLength(1);
      expect(first.embeddings).toHaveLength(1);
      expect(first.embeddings[0].input).toEqual([
        'Terraform',
        'Airflow',
        'Kubernetes',
        'Haskell',
      ]);

      const second = await captured(() => matches(vacancyId).expect(200));
      expect(second.criteria).toHaveLength(0);
      expect(second.embeddings).toHaveLength(1);
    });

    it('reuses the stored criteria for scoring a candidate added from the matches', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();
      await matches(vacancyId).expect(200);

      const requests = await captured(async () => {
        const added = await agent
          .post(`/vacancies/${vacancyId}/applications`)
          .send({ candidateId: devopsId })
          .expect(201);
        await waitForScoreStatus(
          testApp.app,
          cookie,
          vacancyId,
          added.body.id as string,
          'scored',
        );
        await matches(vacancyId).expect(200);
      });

      expect(requests.criteria).toHaveLength(0);
    });

    it('extracts again after the vacancy text changed', async () => {
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const vacancyId = await newVacancy();
      await matches(vacancyId).expect(200);
      await agent
        .patch(`/vacancies/${vacancyId}`)
        .send({ requirements: 'Kubernetes, Terraform and Helm' })
        .expect(200);

      const requests = await captured(() => matches(vacancyId).expect(200));

      expect(requests.criteria).toHaveLength(1);
    });

    it('is not visible to another recruiter, and unknown ids are 404', async () => {
      const vacancyId = await newVacancy();
      const other = await authenticatedAgent();

      const requests = await captured(async () => {
        const res = await other
          .get(`/vacancies/${vacancyId}/matches`)
          .expect(404);
        expect(res.body.message).toBe('Vacancy not found');
        await agent.get(`/vacancies/${randomUUID()}/matches`).expect(404);
      });

      expect(requests.criteria).toHaveLength(0);
      expect(requests.embeddings).toHaveLength(0);
    });

    it('rejects a malformed vacancy id', async () => {
      await agent.get('/vacancies/not-a-uuid/matches').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/vacancies/${randomUUID()}/matches`)
        .expect(401);
    });

    it('answers 409 for a closed vacancy without calling OpenAI', async () => {
      const vacancyId = await newVacancy();
      await agent
        .patch(`/vacancies/${vacancyId}`)
        .send({ status: 'closed' })
        .expect(200);

      const requests = await captured(async () => {
        const res = await matches(vacancyId).expect(409);
        expect(res.body.message).toBe('Vacancy is closed');
        await matches(vacancyId, '?mode=whole_text').expect(409);
      });

      expect(requests.criteria).toHaveLength(0);
      expect(requests.embeddings).toHaveLength(0);
    });

    it('answers 503 when the embeddings service fails', async () => {
      server.use(
        openaiCriteriaHandler(DEVOPS_CRITERIA),
        openaiEmbeddingsErrorHandler(500),
      );
      const vacancyId = await newVacancy();

      const res = await matches(vacancyId).expect(503);
      expect(res.body.message).toBe('Matching is temporarily unavailable');
      await matches(vacancyId, '?mode=whole_text').expect(503);
    });

    it('answers 503 when the inline criteria extraction fails, and stores nothing', async () => {
      server.use(openaiErrorHandler(500, VACANCY_CRITERIA_SCHEMA_NAME));
      const vacancyId = await newVacancy();

      const res = await matches(vacancyId).expect(503);
      expect(res.body.message).toBe('Matching is temporarily unavailable');

      // nothing was stored: the next call (OpenAI back) extracts again
      server.use(openaiCriteriaHandler(DEVOPS_CRITERIA));
      const requests = await captured(() => matches(vacancyId).expect(200));
      expect(requests.criteria).toHaveLength(1);
    });
  });
});
