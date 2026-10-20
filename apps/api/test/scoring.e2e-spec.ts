import { randomUUID } from 'crypto';
import request from 'supertest';
import { normaliseForMatch } from '../src/scoring/verify-quotes.js';
import { applyWithCv } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import {
  criterionIdsFromRequest,
  fabricatedScoreResponse,
  openaiScoreHandler,
  scoreFromRequest,
} from './msw/openai.handlers.js';
import { server } from './msw/server.js';
import { waitForScoreStatus } from './score.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Application scoring (e2e)', () => {
  let testApp: TestApp;
  let cookie: string[];
  let agent: ReturnType<typeof request.agent>;

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
    ({ agent, cookie } = await registerAgent());
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(testApp);
  });

  async function createVacancy() {
    const res = await agent
      .post('/vacancies')
      .send({
        title: 'Backend Engineer',
        requirements: `TypeScript, REST APIs and Docker ${randomUUID()}`,
      })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  /** Applies and returns the new application's id. */
  async function apply(vacancyId: string, applyToken: string) {
    const email = uniqueEmail();
    await applyWithCv(testApp.app, applyToken, {
      name: 'Jane Applicant',
      email,
    }).expect(201);
    const list = await agent.get(`/vacancies/${vacancyId}/applications`);
    const found = (
      list.body as Array<{ id: string; candidate: { email: string } }>
    ).find((a) => a.candidate.email === email.toLowerCase())!;
    return { applicationId: found.id };
  }

  async function cvTextOf(applicationId: string): Promise<string> {
    const { rows } = await testApp.testDb.pool.query<{ text: string }>(
      `SELECT d.text FROM cv_documents d
       JOIN applications a ON a.candidate_id = d.candidate_id
       WHERE a.id = $1 ORDER BY d.created_at DESC LIMIT 1`,
      [applicationId],
    );
    return rows[0].text;
  }

  /** Holds the next score request open until `release()`. */
  function holdScore() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => (started = resolve));
    server.use(
      openaiScoreHandler((body) => scoreFromRequest(body), {
        before: async () => {
          started();
          await gate;
        },
      }),
    );
    return { release, requestStarted };
  }

  const waitFor = (
    vacancyId: string,
    applicationId: string,
    status: Parameters<typeof waitForScoreStatus>[4],
  ) =>
    waitForScoreStatus(testApp.app, cookie, vacancyId, applicationId, status);

  it('scores an application in the background with quotes found in the CV text', async () => {
    const vacancy = await createVacancy();
    const { applicationId } = await apply(vacancy.id, vacancy.applyToken);

    const score = await waitFor(vacancy.id, applicationId, 'scored');

    expect(score).toMatchObject({
      status: 'scored',
      error: null,
      stale: false,
      waitingForParse: false,
    });
    const result = score.result!;
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
    expect(result.criteria.length).toBeGreaterThanOrEqual(3);
    expect(result.mode).toBe('full_text');
    const cv = normaliseForMatch(await cvTextOf(applicationId));
    for (const criterion of result.criteria) {
      expect(criterion.quotes.length).toBeGreaterThan(0);
      for (const quote of criterion.quotes) {
        expect(['cv', 'github']).toContain(quote.source);
        expect(cv).toContain(normaliseForMatch(quote.text));
      }
    }
    // Internal bookkeeping never leaks into the contract.
    expect(Object.keys(score).sort()).toEqual([
      'error',
      'result',
      'stale',
      'status',
      'waitingForParse',
    ]);
  });

  describe('POST /applications/:id/rescore', () => {
    it('answers 202 with the pending score (previous result kept, stale), then scores again', async () => {
      const vacancy = await createVacancy();
      const { applicationId } = await apply(vacancy.id, vacancy.applyToken);
      const first = await waitFor(vacancy.id, applicationId, 'scored');

      const res = await agent
        .post(`/applications/${applicationId}/rescore`)
        .expect(202);

      expect(res.body).toMatchObject({
        status: 'pending',
        error: null,
        stale: true,
        waitingForParse: false,
      });
      expect(res.body.result).toEqual(first.result);

      const again = await waitFor(vacancy.id, applicationId, 'scored');
      expect(again.stale).toBe(false);
      expect(Date.parse(again.result!.scoredAt)).toBeGreaterThanOrEqual(
        Date.parse(first.result!.scoredAt),
      );
    });

    it('answers 409 while scoring is in progress', async () => {
      const vacancy = await createVacancy();
      const hold = holdScore();
      const { applicationId } = await apply(vacancy.id, vacancy.applyToken);
      await hold.requestStarted;
      await waitFor(vacancy.id, applicationId, 'scoring');

      const res = await agent
        .post(`/applications/${applicationId}/rescore`)
        .expect(409);
      expect(res.body.message).toBe('Scoring already in progress');

      hold.release();
      await waitFor(vacancy.id, applicationId, 'scored');
    });

    it("answers 404 for another recruiter's application and an unknown id", async () => {
      const vacancy = await createVacancy();
      const { applicationId } = await apply(vacancy.id, vacancy.applyToken);
      await waitFor(vacancy.id, applicationId, 'scored');
      const other = await registerAgent();

      const foreign = await other.agent
        .post(`/applications/${applicationId}/rescore`)
        .expect(404);
      expect(foreign.body.message).toBe('Application not found');
      await other.agent
        .post(`/applications/${randomUUID()}/rescore`)
        .expect(404);

      // untouched: still scored, nothing queued
      const score = await waitFor(vacancy.id, applicationId, 'scored');
      expect(score.stale).toBe(false);
    });

    it('rejects a malformed id and a missing session', async () => {
      await agent.post('/applications/not-a-uuid/rescore').expect(400);
      await request(testApp.app.getHttpServer())
        .post(`/applications/${randomUUID()}/rescore`)
        .expect(401);
    });
  });

  it('records a failed score and shows the error in the list when every quote is fabricated', async () => {
    server.use(
      openaiScoreHandler((body) =>
        fabricatedScoreResponse(criterionIdsFromRequest(body)),
      ),
    );
    const vacancy = await createVacancy();
    const { applicationId } = await apply(vacancy.id, vacancy.applyToken);

    const score = await waitFor(vacancy.id, applicationId, 'failed');

    expect(score.error).toBe('Could not ground the score in the CV');
    expect(score.result).toBeNull();
    expect(score.stale).toBe(false);
  });
});
