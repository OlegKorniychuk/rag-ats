import { randomUUID } from 'crypto';
import request from 'supertest';
import { applyWithCv, fixtureBytes } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Candidates (e2e)', () => {
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

  async function createVacancyWithToken(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    overrides: { title?: string; requirements?: string } = {},
  ): Promise<{ id: string; applyToken: string }> {
    const res = await agent
      .post('/vacancies')
      .send({
        title: overrides.title ?? 'Senior Backend Engineer',
        requirements: overrides.requirements ?? '5+ years Node.js, PostgreSQL',
      })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  function applicationPayload(overrides: Record<string, string> = {}) {
    return {
      name: 'Jane Applicant',
      email: uniqueEmail(),
      ...overrides,
    };
  }

  async function applyToVacancy(
    applyToken: string,
    overrides: Record<string, string> = {},
  ): Promise<{
    name: string;
    email: string;
  }> {
    const payload = applicationPayload(overrides);
    await applyWithCv(testApp.app, applyToken, payload).expect(201);
    return payload;
  }

  async function findCandidateId(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    email: string,
  ): Promise<string> {
    const res = await agent.get('/candidates').expect(200);
    const match = (res.body as { id: string; email: string }[]).find(
      (c) => c.email === email.toLowerCase(),
    );
    if (!match) throw new Error('candidate not found in list');
    return match.id;
  }

  describe('GET /candidates', () => {
    it("lists a candidate who only applied to another recruiter's vacancy", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);

      const recruiterB = await authenticatedAgent();
      const res = await recruiterB.get('/candidates').expect(200);

      const emails = (res.body as { email: string }[]).map((c) => c.email);
      expect(emails).toContain(applicant.email.toLowerCase());
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer()).get('/candidates').expect(401);
    });
  });

  describe('GET /candidates/:id', () => {
    it("returns the candidate's profile without exposing applications", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);

      const recruiterB = await authenticatedAgent();
      const candidateId = await findCandidateId(recruiterB, applicant.email);

      const res = await recruiterB
        .get(`/candidates/${candidateId}`)
        .expect(200);

      expect(res.body).toMatchObject({
        name: applicant.name,
        email: applicant.email.toLowerCase(),
      });
      expect(res.body.applications).toBeUndefined();
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/candidates/${randomUUID()}`).expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);

      await request(testApp.app.getHttpServer())
        .get(`/candidates/${candidateId}`)
        .expect(401);
    });
  });

  describe('GET /candidates/:id/cv', () => {
    const binaryParser = (
      res: request.Response,
      cb: (err: Error | null, body: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };

    async function applyAndGetId(
      agent: Awaited<ReturnType<typeof authenticatedAgent>>,
      applyToken: string,
      email: string,
      fixture = 'cv-text.pdf',
      uploadName?: string,
    ): Promise<string> {
      await applyWithCv(
        testApp.app,
        applyToken,
        { name: 'Jane Applicant', email },
        fixture,
        uploadName,
      ).expect(201);
      return findCandidateId(agent, email);
    }

    it('returns the uploaded PDF inline with safe headers', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(agent);
      const id = await applyAndGetId(agent, applyToken, uniqueEmail());

      const res = await agent
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['content-disposition']).toContain('inline;');
      expect(res.headers['content-disposition']).toContain(
        'filename="cv-text.pdf"',
      );
      expect(res.headers['content-length']).toBe(
        String(fixtureBytes('cv-text.pdf').length),
      );
      expect((res.body as Buffer).equals(fixtureBytes('cv-text.pdf'))).toBe(
        true,
      );
    });

    it('returns the newer CV after a later application', async () => {
      const agent = await authenticatedAgent();
      const first = await createVacancyWithToken(agent);
      const second = await createVacancyWithToken(agent);
      const email = uniqueEmail();
      const id = await applyAndGetId(agent, first.applyToken, email);
      await applyAndGetId(agent, second.applyToken, email, 'cv-text-2.pdf');

      const res = await agent
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect((res.body as Buffer).equals(fixtureBytes('cv-text-2.pdf'))).toBe(
        true,
      );
    });

    it("lets another recruiter download the candidate's CV", async () => {
      const owner = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(owner);
      const email = uniqueEmail();
      await applyAndGetId(owner, applyToken, email);

      const other = await authenticatedAgent();
      const id = await findCandidateId(other, email);
      const res = await other
        .get(`/candidates/${id}/cv`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect((res.body as Buffer).equals(fixtureBytes('cv-text.pdf'))).toBe(
        true,
      );
    });

    it('encodes a non-ASCII filename per RFC 5987', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(agent);
      const id = await applyAndGetId(
        agent,
        applyToken,
        uniqueEmail(),
        'cv-text.pdf',
        'résumé.pdf',
      );

      const res = await agent.get(`/candidates/${id}/cv`).expect(200);

      expect(res.headers['content-disposition']).toContain(
        "filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
      );
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent.get(`/candidates/${randomUUID()}/cv`).expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid/cv').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/candidates/${randomUUID()}/cv`)
        .expect(401);
    });
  });

  describe('GET /candidates/:id/applications', () => {
    it("lists the candidate's applications on the recruiter's own vacancies only, newest first", async () => {
      const recruiterA = await authenticatedAgent();
      const vacancyA = await createVacancyWithToken(recruiterA, {
        title: 'Role A',
      });
      const applicant = await applyToVacancy(vacancyA.applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);
      const vacancyB = await createVacancyWithToken(recruiterA, {
        title: 'Role B',
      });
      await recruiterA
        .post(`/vacancies/${vacancyB.id}/applications`)
        .send({ candidateId })
        .expect(201);
      const closed = await createVacancyWithToken(recruiterA, {
        title: 'Role closed',
      });
      await recruiterA
        .post(`/vacancies/${closed.id}/applications`)
        .send({ candidateId })
        .expect(201);
      await recruiterA
        .patch(`/vacancies/${closed.id}`)
        .send({ status: 'closed' })
        .expect(200);

      // a second recruiter puts the same candidate on their own vacancy
      const recruiterB = await authenticatedAgent();
      const foreignVacancy = await createVacancyWithToken(recruiterB, {
        title: 'Foreign role',
      });
      await recruiterB
        .post(`/vacancies/${foreignVacancy.id}/applications`)
        .send({ candidateId })
        .expect(201);

      const mine = await recruiterA
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);

      expect(
        (mine.body as { vacancyTitle: string }[]).map((a) => a.vacancyTitle),
      ).toEqual(['Role closed', 'Role B', 'Role A']);
      expect(mine.body[0]).toMatchObject({
        vacancyId: closed.id,
        vacancyStatus: 'closed',
        stage: 'applied',
        source: 'added',
        createdAt: expect.any(String),
        score: {
          status: expect.any(String),
          error: null,
          stale: false,
          waitingForParse: expect.any(Boolean),
        },
      });
      expect(mine.body[1]).toMatchObject({
        vacancyId: vacancyB.id,
        vacancyStatus: 'open',
        source: 'added',
      });
      expect(mine.body[2]).toMatchObject({
        vacancyId: vacancyA.id,
        vacancyTitle: 'Role A',
        vacancyStatus: 'open',
        source: 'applied',
      });
      expect(JSON.stringify(mine.body)).not.toContain(foreignVacancy.id);

      const theirs = await recruiterB
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);
      expect(theirs.body).toHaveLength(1);
      expect(theirs.body[0]).toMatchObject({
        vacancyId: foreignVacancy.id,
        vacancyTitle: 'Foreign role',
        source: 'added',
      });
    });

    it("returns an empty array when the candidate is not on any of the recruiter's vacancies", async () => {
      const recruiterA = await authenticatedAgent();
      const { applyToken } = await createVacancyWithToken(recruiterA);
      const applicant = await applyToVacancy(applyToken);
      const candidateId = await findCandidateId(recruiterA, applicant.email);

      const recruiterB = await authenticatedAgent();
      const res = await recruiterB
        .get(`/candidates/${candidateId}/applications`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      const res = await agent
        .get(`/candidates/${randomUUID()}/applications`)
        .expect(404);

      expect(res.body.message).toBe('Candidate not found');
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent.get('/candidates/not-a-uuid/applications').expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/candidates/${randomUUID()}/applications`)
        .expect(401);
    });
  });
});
