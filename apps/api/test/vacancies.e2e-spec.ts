import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import { openaiProfileHandler } from './msw/openai.handlers.js';
import { DEFAULT_MOCK_PROFILE, server } from './msw/server.js';
import { waitForParseStatus } from './parse.util.js';
import { waitForScoreStatus } from './score.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Vacancies (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
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
});
