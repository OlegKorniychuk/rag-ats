import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

describe('AppController (e2e)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  it('GET / returns 200', async () => {
    await request(testApp.app.getHttpServer()).get('/').expect(200);
  });
});
