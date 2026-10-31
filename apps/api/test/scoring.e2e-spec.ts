import { randomUUID } from 'crypto';
import type { ApplicationScore } from '@rag-ats/shared';
import request from 'supertest';
import { normaliseForMatch } from '../src/scoring/verify-quotes.js';
import { applyWithCv } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';
import {
  captureOpenaiRequests,
  criterionIdsFromRequest,
  fabricatedScoreResponse,
  openaiCriteriaHandler,
  openaiScoreHandler,
  schemaNameOf,
  scoreFromRequest,
  type MockCriterion,
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
  const capture = captureOpenaiRequests();

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

  afterAll(async () => {
    server.events.removeListener('request:start', capture.listener);
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

  describe('PATCH /vacancies/:id (auto-rescore)', () => {
    const NEW_CRITERIA: MockCriterion[] = [
      { text: 'Experience with Kubernetes', importance: 'must' },
      { text: 'Knowledge of Terraform', importance: 'nice' },
    ];
    // a settle period for "nothing happens" assertions
    const SETTLE_MS = 750;

    const settle = () =>
      new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const requestsFor = (schema: string) =>
      capture.bodies.filter((body) => schemaNameOf(body) === schema);

    /** Holds the next criteria extraction open until `release()`. */
    function holdCriteria(criteria: MockCriterion[]) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      server.use(openaiCriteriaHandler(criteria, { before: () => gate }));
      return { release };
    }

    async function listScores(vacancyId: string) {
      const res = await agent
        .get(`/vacancies/${vacancyId}/applications`)
        .expect(200);
      return (res.body as Array<{ id: string; score: ApplicationScore }>).map(
        (a) => ({ id: a.id, score: a.score }),
      );
    }

    /** A vacancy with `count` applicants, all scored; capture is cleared. */
    async function scoredVacancy(count = 1) {
      const vacancy = await createVacancy();
      const applicationIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const { applicationId } = await apply(vacancy.id, vacancy.applyToken);
        applicationIds.push(applicationId);
      }
      const scores: ApplicationScore[] = [];
      for (const id of applicationIds) {
        scores.push(await waitFor(vacancy.id, id, 'scored'));
      }
      capture.bodies.length = 0;
      return { ...vacancy, applicationIds, scores };
    }

    function expectCriteria(
      score: ApplicationScore,
      criteria: MockCriterion[],
    ) {
      expect(score.result!.criteria.map((c) => c.criterion)).toEqual(
        criteria.map((c) => c.text),
      );
    }

    it('rescores every applicant after the requirements of an open vacancy change', async () => {
      const vacancy = await scoredVacancy(2);
      const hold = holdCriteria(NEW_CRITERIA);
      const requirements = `Kubernetes and Terraform ${randomUUID()}`;

      const res = await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ requirements })
        .expect(200);
      expect(res.body).toMatchObject({ id: vacancy.id, requirements });

      // extraction is held, so the reset is observable: old result kept, stale
      const during = await listScores(vacancy.id);
      expect(during).toHaveLength(2);
      for (const { id, score } of during) {
        expect(score).toMatchObject({
          status: 'pending',
          stale: true,
          error: null,
        });
        expect(score.result).toEqual(
          vacancy.scores[vacancy.applicationIds.indexOf(id)].result,
        );
      }

      hold.release();
      for (const id of vacancy.applicationIds) {
        const score = await waitFor(vacancy.id, id, 'scored');
        expect(score.stale).toBe(false);
        expectCriteria(score, NEW_CRITERIA);
      }
      // one shared extraction for both applicants, on the new requirements
      const extractions = requestsFor('vacancy_criteria');
      expect(extractions).toHaveLength(1);
      expect(JSON.stringify(extractions[0])).toContain(requirements);
      expect(requestsFor('application_score')).toHaveLength(2);
    });

    it('rescores after a title-only change', async () => {
      const vacancy = await scoredVacancy();
      server.use(openaiCriteriaHandler(NEW_CRITERIA));

      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ title: 'Platform Engineer' })
        .expect(200);

      const score = await waitFor(
        vacancy.id,
        vacancy.applicationIds[0],
        'scored',
      );
      expect(score.stale).toBe(false);
      expectCriteria(score, NEW_CRITERIA);
      expect(requestsFor('vacancy_criteria')).toHaveLength(1);
    });

    it('does nothing for a whitespace-only change or a status-only close', async () => {
      const vacancy = await scoredVacancy();
      const before = await listScores(vacancy.id);
      const current = (await agent.get(`/vacancies/${vacancy.id}`).expect(200))
        .body as { title: string; requirements: string };

      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({
          title: `  ${current.title}  `,
          requirements: current.requirements.replace(/ /g, '   '),
        })
        .expect(200);
      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ status: 'closed' })
        .expect(200);
      await settle();

      expect(capture.bodies).toHaveLength(0);
      expect(await listScores(vacancy.id)).toEqual(before);
      expect(before[0].score).toMatchObject({
        status: 'scored',
        stale: false,
      });
    });

    it('only marks scores stale while the vacancy is closed, and rescores on reopen', async () => {
      const vacancy = await scoredVacancy();
      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ status: 'closed' })
        .expect(200);

      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ requirements: `Kubernetes only ${randomUUID()}` })
        .expect(200);
      await settle();

      expect(capture.bodies).toHaveLength(0);
      const [closed] = await listScores(vacancy.id);
      expect(closed.score).toMatchObject({ status: 'scored', stale: true });
      expect(closed.score.result).toEqual(vacancy.scores[0].result);

      const hold = holdCriteria(NEW_CRITERIA);
      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ status: 'open' })
        .expect(200);

      const [reopened] = await listScores(vacancy.id);
      expect(reopened.score).toMatchObject({ status: 'pending', stale: true });

      hold.release();
      const score = await waitFor(
        vacancy.id,
        vacancy.applicationIds[0],
        'scored',
      );
      expect(score.stale).toBe(false);
      expectCriteria(score, NEW_CRITERIA);
      expect(requestsFor('vacancy_criteria')).toHaveLength(1);
    });

    it('makes no LLM call when reopening with nothing outdated', async () => {
      const vacancy = await scoredVacancy();
      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ status: 'closed' })
        .expect(200);
      await agent
        .patch(`/vacancies/${vacancy.id}`)
        .send({ status: 'open' })
        .expect(200);
      await settle();

      expect(capture.bodies).toHaveLength(0);
      const [only] = await listScores(vacancy.id);
      expect(only.score).toMatchObject({ status: 'scored', stale: false });
      expect(only.score.result).toEqual(vacancy.scores[0].result);
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
