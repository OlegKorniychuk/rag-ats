import { randomUUID } from 'crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
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

describe('Apply (e2e)', () => {
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
  ): Promise<{ id: string; applyToken: string }> {
    const res = await agent
      .post('/vacancies')
      .send({
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
      })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  describe('GET /apply/:token', () => {
    it('returns role details for a valid token, no auth required', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancy(agent);

      const res = await request(testApp.app.getHttpServer())
        .get(`/apply/${applyToken}`)
        .expect(200);

      expect(res.body).toEqual({
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
        status: 'open',
      });
    });

    it('returns 404 for an unknown token', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/apply/${randomUUID()}`)
        .expect(404);
    });

    it('still resolves for a closed vacancy', async () => {
      const agent = await authenticatedAgent();
      const { id, applyToken } = await createVacancy(agent);
      await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'closed' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/apply/${applyToken}`)
        .expect(200);

      expect(res.body.status).toBe('closed');
    });
  });

  describe('POST /apply/:token', () => {
    it('creates a new candidate and application', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancy(agent);
      const payload = applicationPayload();

      const res = await request(testApp.app.getHttpServer())
        .post(`/apply/${applyToken}`)
        .send(payload)
        .expect(201);

      expect(res.body).toEqual({ success: true });

      const candidates = await testApp.testDb.db.query.candidates.findMany({
        where: { email: payload.email },
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].skills).toEqual(payload.skills);
    });

    it('merges a repeat applicant (different casing) into the same candidate row', async () => {
      const agent = await authenticatedAgent();
      const { applyToken: firstToken } = await createVacancy(agent);
      const { applyToken: secondToken } = await createVacancy(agent);
      const email = uniqueEmail();

      const firstPayload = applicationPayload({
        email,
        skills: ['TypeScript', 'Node.js'],
        experience: 'First role experience.',
        summary: 'Original summary.',
      });
      await request(testApp.app.getHttpServer())
        .post(`/apply/${firstToken}`)
        .send(firstPayload)
        .expect(201);

      const secondPayload = applicationPayload({
        email: email.toUpperCase(),
        skills: ['typescript', 'PostgreSQL'],
        experience: 'Second role experience.',
        summary: 'Latest summary.',
      });
      await request(testApp.app.getHttpServer())
        .post(`/apply/${secondToken}`)
        .send(secondPayload)
        .expect(201);

      const candidates = await testApp.testDb.db.query.candidates.findMany({
        where: { email: email.toLowerCase() },
      });
      expect(candidates).toHaveLength(1);
      const candidate = candidates[0];
      expect(candidate.skills).toEqual(['TypeScript', 'Node.js', 'PostgreSQL']);
      expect(candidate.experience).toBe(
        'First role experience.\n\nSecond role experience.',
      );
      expect(candidate.summary).toBe('Latest summary.');

      const applications = await testApp.testDb.db.query.applications.findMany({
        where: { candidateId: candidate.id },
      });
      expect(applications).toHaveLength(2);
      expect(applications.every((a) => a.stage === 'applied')).toBe(true);
    });

    it('returns 409 when the same candidate applies to the same vacancy twice', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancy(agent);
      const payload = applicationPayload();

      await request(testApp.app.getHttpServer())
        .post(`/apply/${applyToken}`)
        .send(payload)
        .expect(201);

      await request(testApp.app.getHttpServer())
        .post(`/apply/${applyToken}`)
        .send(payload)
        .expect(409);
    });

    it('returns 404 for an unknown token', async () => {
      await request(testApp.app.getHttpServer())
        .post(`/apply/${randomUUID()}`)
        .send(applicationPayload())
        .expect(404);
    });

    it('returns 409 for a closed vacancy', async () => {
      const agent = await authenticatedAgent();
      const { id, applyToken } = await createVacancy(agent);
      await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'closed' })
        .expect(200);

      await request(testApp.app.getHttpServer())
        .post(`/apply/${applyToken}`)
        .send(applicationPayload())
        .expect(409);
    });

    describe('validation', () => {
      let applyToken: string;

      beforeAll(async () => {
        const agent = await authenticatedAgent();
        ({ applyToken } = await createVacancy(agent));
      });

      it('rejects a missing name', async () => {
        const payload = applicationPayload() as Record<string, unknown>;
        delete payload.name;

        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .send(payload)
          .expect(400);
      });

      it('rejects an invalid email', async () => {
        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .send(applicationPayload({ email: 'not-an-email' }))
          .expect(400);
      });

      it('rejects an empty skills array', async () => {
        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .send(applicationPayload({ skills: [] }))
          .expect(400);
      });

      it('rejects an invalid githubUrl', async () => {
        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .send(applicationPayload({ githubUrl: 'not-a-url' }))
          .expect(400);
      });

      it('rejects an unknown extra field', async () => {
        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .send(applicationPayload({ notAField: 'surprise' }))
          .expect(400);
      });
    });
  });
});
