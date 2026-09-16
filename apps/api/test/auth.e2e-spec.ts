import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { closeTestApp, createTestApp, TestApp } from './e2e-app.util';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Auth (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  describe('POST /auth/register', () => {
    it('registers a new recruiter', async () => {
      const email = uniqueEmail();

      const res = await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123' })
        .expect(201);

      expect(res.body).toMatchObject({ email });
      expect(res.body.id).toBeDefined();
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects a duplicate email', async () => {
      const email = uniqueEmail();

      await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123' })
        .expect(201);

      await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'password123' })
        .expect(409);
    });

    it('rejects an invalid email', async () => {
      await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123' })
        .expect(400);
    });

    it('rejects a password shorter than 8 characters', async () => {
      await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail(), password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    async function registerRecruiter(
      email: string,
      password: string,
    ): Promise<void> {
      await request(testApp.app.getHttpServer())
        .post('/auth/register')
        .send({ email, password })
        .expect(201);
    }

    it('logs in and sets the access_token cookie', async () => {
      const email = uniqueEmail();
      const password = 'password123';
      await registerRecruiter(email, password);

      const res = await request(testApp.app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookie = String(setCookie[0]);
      expect(cookie).toMatch(/^access_token=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('rejects a wrong password', async () => {
      const email = uniqueEmail();
      await registerRecruiter(email, 'password123');

      await request(testApp.app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
    });

    it('rejects an unknown email', async () => {
      await request(testApp.app.getHttpServer())
        .post('/auth/login')
        .send({ email: uniqueEmail(), password: 'password123' })
        .expect(401);
    });
  });
});
