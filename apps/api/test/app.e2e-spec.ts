import * as request from 'supertest';
import { closeTestApp, createTestApp, TestApp } from './e2e-app.util';

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
