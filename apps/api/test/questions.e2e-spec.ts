import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import {
  captureOpenaiRequests,
  openaiQuestionsHandler,
  openaiScoreHandler,
  scoreFromRequest,
} from './msw/openai.handlers.js';
import { server } from './msw/server.js';
import { waitForQuestionsStatus, waitForScoreStatus } from './score.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

/** A gate that holds a mocked request in flight until `release()`. */
function gate() {
  let release!: () => void;
  let started!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const requestStarted = new Promise<void>((resolve) => (started = resolve));
  return {
    release,
    requestStarted,
    before: async () => {
      started();
      await released;
    },
  };
}

describe('Interview questions (e2e)', () => {
  let testApp: TestApp;
  let cookie: string[];
  let agent: ReturnType<typeof request.agent>;
  const capture = captureOpenaiRequests('interview_questions');

  async function registerAgent() {
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
    const recruiter = request.agent(testApp.app.getHttpServer());
    await recruiter.post('/auth/login').send({ email, password }).expect(201);
    return {
      agent: recruiter,
      cookie: login.headers['set-cookie'] as unknown as string[],
    };
  }

  beforeAll(async () => {
    testApp = await createTestApp();
    server.events.on('request:start', capture.listener);
    ({ agent, cookie } = await registerAgent());
  }, 60_000);

  afterEach(() => {
    capture.bodies.length = 0;
  });

  afterAll(async () => {
    server.events.removeListener('request:start', capture.listener);
    await closeTestApp(testApp);
  });

  /** Creates a vacancy, applies, and (by default) waits for the score. */
  async function scoredApplication(opts: { waitScored?: boolean } = {}) {
    const created = await agent
      .post('/vacancies')
      .send({
        title: 'Backend Engineer',
        requirements: `TypeScript, REST APIs and Docker ${randomUUID()}`,
      })
      .expect(201);
    const vacancyId = created.body.id as string;
    const email = uniqueEmail();
    await applyWithCv(testApp.app, created.body.applyToken as string, {
      name: 'Jane Applicant',
      email,
    }).expect(201);
    const list = await agent.get(`/vacancies/${vacancyId}/applications`);
    const applicationId = (
      list.body as Array<{ id: string; candidate: { email: string } }>
    ).find((a) => a.candidate.email === email.toLowerCase())!.id;
    if (opts.waitScored ?? true) {
      await waitForScoreStatus(
        testApp.app,
        cookie,
        vacancyId,
        applicationId,
        'scored',
      );
    }
    return { vacancyId, applicationId };
  }

  const waitForQuestions = (
    applicationId: string,
    status: Parameters<typeof waitForQuestionsStatus>[3],
  ) => waitForQuestionsStatus(testApp.app, cookie, applicationId, status);

  it('GET returns status null before any request', async () => {
    const { applicationId } = await scoredApplication();

    const res = await agent
      .get(`/applications/${applicationId}/questions`)
      .expect(200);

    expect(res.body).toEqual({
      status: null,
      error: null,
      stale: false,
      result: null,
    });
  });

  it('POST returns 202 pending, then GET returns ready questions', async () => {
    const { applicationId } = await scoredApplication();

    const res = await agent
      .post(`/applications/${applicationId}/questions`)
      .expect(202);
    expect(res.body).toEqual({
      status: 'pending',
      error: null,
      stale: false,
      result: null,
    });

    const ready = await waitForQuestions(applicationId, 'ready');
    expect(ready.stale).toBe(false);
    expect(ready.result!.questions.map((q) => q.basis)).toEqual([
      'fact',
      'gap',
    ]);
    expect(ready.result!.questions[0].quotes).toHaveLength(1);
    expect(ready.result!.model).toBe('gpt-5.4-mini');
    expect(capture.bodies).toHaveLength(1);
  });

  it('POST returns 409 when the score is pending or stale', async () => {
    const hold = gate();
    server.use(
      openaiScoreHandler((body) => scoreFromRequest(body), {
        before: hold.before,
      }),
    );
    const { vacancyId, applicationId } = await scoredApplication({
      waitScored: false,
    });
    await hold.requestStarted;

    const pending = await agent
      .post(`/applications/${applicationId}/questions`)
      .expect(409);
    expect(pending.body.message).toBe('Score the application first');

    hold.release();
    await waitForScoreStatus(
      testApp.app,
      cookie,
      vacancyId,
      applicationId,
      'scored',
    );
    // A closed vacancy's edit marks the score stale without rescoring it.
    await agent
      .patch(`/vacancies/${vacancyId}`)
      .send({ status: 'closed' })
      .expect(200);
    await agent
      .patch(`/vacancies/${vacancyId}`)
      .send({ requirements: 'Completely different requirements' })
      .expect(200);

    const stale = await agent
      .post(`/applications/${applicationId}/questions`)
      .expect(409);
    expect(stale.body.message).toBe('Score the application first');
    expect(capture.bodies).toHaveLength(0);
  });

  it('POST returns 409 while generating', async () => {
    const { applicationId } = await scoredApplication();
    const hold = gate();
    server.use(openaiQuestionsHandler(undefined, { before: hold.before }));
    await agent.post(`/applications/${applicationId}/questions`).expect(202);
    await hold.requestStarted;

    const res = await agent
      .post(`/applications/${applicationId}/questions`)
      .expect(409);
    expect(res.body.message).toBe('Questions are already being generated');

    hold.release();
    await waitForQuestions(applicationId, 'ready');
  });

  it("GET and POST return 404 for another recruiter's application and 400 for a malformed uuid", async () => {
    const { applicationId } = await scoredApplication();
    const other = await registerAgent();

    for (const method of ['get', 'post'] as const) {
      const foreign = await other.agent[method](
        `/applications/${applicationId}/questions`,
      ).expect(404);
      expect(foreign.body.message).toBe('Application not found');
      await other.agent[method](
        `/applications/${randomUUID()}/questions`,
      ).expect(404);
      await agent[method]('/applications/not-a-uuid/questions').expect(400);
      await request(testApp.app.getHttpServer())
        [method](`/applications/${applicationId}/questions`)
        .expect(401);
    }
    expect(capture.bodies).toHaveLength(0);
  });

  it('POST after ready keeps the previous result and reports stale while pending', async () => {
    const { applicationId } = await scoredApplication();
    await agent.post(`/applications/${applicationId}/questions`).expect(202);
    const first = await waitForQuestions(applicationId, 'ready');

    const res = await agent
      .post(`/applications/${applicationId}/questions`)
      .expect(202);

    expect(res.body).toEqual({
      status: 'pending',
      error: null,
      stale: true,
      result: first.result,
    });
    const again = await waitForQuestions(applicationId, 'ready');
    expect(again.stale).toBe(false);
  });
});
