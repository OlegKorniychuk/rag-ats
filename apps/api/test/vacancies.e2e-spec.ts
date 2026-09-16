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
});
