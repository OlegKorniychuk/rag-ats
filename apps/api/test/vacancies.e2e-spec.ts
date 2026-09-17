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

  async function createVacancy(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    overrides: { title?: string; requirements?: string } = {},
  ): Promise<string> {
    const res = await agent
      .post('/vacancies')
      .send({
        title: overrides.title ?? 'Senior Backend Engineer',
        requirements: overrides.requirements ?? '5+ years Node.js, PostgreSQL',
      })
      .expect(201);
    return res.body.id as string;
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
});
