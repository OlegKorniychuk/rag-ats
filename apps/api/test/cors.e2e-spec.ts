import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

describe('CORS (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('preflight OPTIONS /vacancies allows the configured origin with credentials', async () => {
    const res = await request(testApp.app.getHttpServer())
      .options('/vacancies')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('GET / with the configured origin returns CORS headers', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('GET / with an unconfigured origin has no CORS headers', async () => {
    const res = await request(testApp.app.getHttpServer())
      .get('/')
      .set('Origin', 'http://evil.example')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
