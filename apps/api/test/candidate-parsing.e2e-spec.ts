import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import {
  captureOpenaiRequests,
  openaiProfileHandler,
  openaiRefusalHandler,
  type MockProfile,
} from './msw/openai.handlers.js';
import { DEFAULT_MOCK_PROFILE, server } from './msw/server.js';
import { waitForParseStatus } from './parse.util.js';

const SECOND_PROFILE: MockProfile = {
  skills: ['React', 'Accessibility'],
  experience: '3 years of frontend work',
  projects: ['Design system'],
  summary: 'Frontend developer.',
};

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('CV parsing (e2e)', () => {
  let testApp: TestApp;
  let cookie: string[];
  let agent: ReturnType<typeof request.agent>;
  const capture = captureOpenaiRequests();

  beforeAll(async () => {
    testApp = await createTestApp();
    server.events.on('request:start', capture.listener);

    const email = uniqueEmail();
    const password = 'password123';
    await request(testApp.app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);
    const login = await request(testApp.app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    cookie = login.headers['set-cookie'] as unknown as string[];
    agent = request.agent(testApp.app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(201);
  }, 60_000);

  afterEach(() => {
    capture.bodies.length = 0;
  });

  afterAll(async () => {
    server.events.removeListener('request:start', capture.listener);
    await closeTestApp(testApp);
  });

  async function createVacancy() {
    const res = await agent
      .post('/vacancies')
      .send({ title: 'Engineer', requirements: 'TypeScript' })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  async function apply(applyToken: string, email: string, fixture?: string) {
    await applyWithCv(
      testApp.app,
      applyToken,
      { name: 'Jane Applicant', email },
      fixture,
    ).expect(201);
    const list = await agent.get('/candidates').expect(200);
    return (list.body as { id: string; email: string }[]).find(
      (c) => c.email === email.toLowerCase(),
    )!.id;
  }

  /** Holds the next LLM request open until `release()` is called. */
  function holdLlm(profile: MockProfile = DEFAULT_MOCK_PROFILE) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    server.use(
      openaiProfileHandler(profile, {
        before: async () => {
          started();
          await gate;
        },
      }),
    );
    return { release, requestStarted };
  }

  it('parses on apply and exposes the profile on the candidate and application endpoints', async () => {
    const { id: vacancyId, applyToken } = await createVacancy();
    const candidateId = await apply(applyToken, uniqueEmail());

    const parsed = await waitForParseStatus(
      testApp.app,
      cookie,
      candidateId,
      'parsed',
    );

    expect(parsed).toMatchObject({ ...DEFAULT_MOCK_PROFILE, parseError: null });

    const apps = await agent
      .get(`/vacancies/${vacancyId}/applications`)
      .expect(200);
    expect(apps.body).toHaveLength(1);
    expect(apps.body[0].candidate).toMatchObject({
      ...DEFAULT_MOCK_PROFILE,
      parseStatus: 'parsed',
    });
  });

  it('re-parses from the new CV when a repeat applicant uploads another one', async () => {
    const first = await createVacancy();
    const second = await createVacancy();
    const email = uniqueEmail();
    const candidateId = await apply(first.applyToken, email);
    await waitForParseStatus(testApp.app, cookie, candidateId, 'parsed');

    const hold = holdLlm(SECOND_PROFILE);
    await apply(second.applyToken, email, 'cv-text-2.pdf');
    await hold.requestStarted;

    const inFlight = await agent.get(`/candidates/${candidateId}`).expect(200);
    expect(inFlight.body.parseStatus).toMatch(/^(pending|parsing)$/);
    // the previous profile stays visible until the new one lands
    expect(inFlight.body.skills).toEqual(DEFAULT_MOCK_PROFILE.skills);

    hold.release();
    const reparsed = await waitForParseStatus(
      testApp.app,
      cookie,
      candidateId,
      'parsed',
    );

    expect(reparsed).toMatchObject(SECOND_PROFILE);
    expect(JSON.stringify(capture.bodies.at(-1))).toContain('John Smith');
  });

  it('records a failure, then reparse recovers it', async () => {
    server.use(openaiRefusalHandler());
    const { applyToken } = await createVacancy();
    const candidateId = await apply(applyToken, uniqueEmail());

    const failed = await waitForParseStatus(
      testApp.app,
      cookie,
      candidateId,
      'failed',
    );
    expect(failed.parseError).toBe(
      'The model could not extract a profile from the CV',
    );

    server.resetHandlers();
    const res = await agent
      .post(`/candidates/${candidateId}/reparse`)
      .expect(202);
    expect(res.body).toMatchObject({
      id: candidateId,
      parseStatus: 'pending',
      parseError: null,
    });

    const parsed = await waitForParseStatus(
      testApp.app,
      cookie,
      candidateId,
      'parsed',
    );
    expect(parsed).toMatchObject(DEFAULT_MOCK_PROFILE);
  });

  describe('POST /candidates/:id/reparse', () => {
    it('returns 409 while parsing is in progress', async () => {
      const hold = holdLlm();
      const { applyToken } = await createVacancy();
      const candidateId = await apply(applyToken, uniqueEmail());
      await hold.requestStarted;
      await waitForParseStatus(testApp.app, cookie, candidateId, 'parsing');

      const res = await agent
        .post(`/candidates/${candidateId}/reparse`)
        .expect(409);
      expect(res.body.message).toBe('CV parsing is already in progress');

      hold.release();
      await waitForParseStatus(testApp.app, cookie, candidateId, 'parsed');
    });

    it('allows reparsing a parsed candidate', async () => {
      const { applyToken } = await createVacancy();
      const candidateId = await apply(applyToken, uniqueEmail());
      await waitForParseStatus(testApp.app, cookie, candidateId, 'parsed');

      server.use(openaiProfileHandler(SECOND_PROFILE));
      await agent.post(`/candidates/${candidateId}/reparse`).expect(202);

      const reparsed = await waitForParseStatus(
        testApp.app,
        cookie,
        candidateId,
        'parsed',
      );
      // reparse flips to pending before responding, so `parsed` is the new run
      expect(reparsed).toMatchObject(SECOND_PROFILE);
    });

    it('returns 404 for an unknown id', async () => {
      const res = await agent
        .post(`/candidates/${randomUUID()}/reparse`)
        .expect(404);
      expect(res.body.message).toBe('Candidate not found');
    });

    it('rejects a malformed id', async () => {
      await agent.post('/candidates/not-a-uuid/reparse').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .post(`/candidates/${randomUUID()}/reparse`)
        .expect(401);
    });
  });
});
