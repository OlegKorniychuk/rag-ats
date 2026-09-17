import { randomUUID } from 'crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
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
});
