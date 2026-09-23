import { randomUUID } from 'crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

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

  async function createVacancy(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    overrides: { title?: string; requirements?: string } = {},
  ): Promise<string> {
    const { id } = await createVacancyWithToken(agent, overrides);
    return id;
  }

  function applicationPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Jane Applicant',
      email: uniqueEmail(),
      skills: ['TypeScript', 'Node.js'],
      experience: 'Built things at a company.',
      projects: ['Cool project'],
      summary: 'A backend engineer looking for new challenges.',
      ...overrides,
    };
  }

  async function applyToVacancy(
    applyToken: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ name: string; email: string }> {
    const payload = applicationPayload(overrides);
    await request(testApp.app.getHttpServer())
      .post(`/apply/${applyToken}`)
      .send(payload)
      .expect(201);
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
        candidate: { name: first.name, email: first.email.toLowerCase() },
      });

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
});
