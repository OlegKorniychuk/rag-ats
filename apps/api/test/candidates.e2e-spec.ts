import { randomUUID } from 'crypto';
import request from 'supertest';
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

  function applicationPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Jane Applicant',
      email: uniqueEmail(),
      skills: ['TypeScript', 'Node.js'],
      experience: 'Built things at a company.',
      projects: ['Cool project'],
      summary: 'A backend engineer looking for new challenges.',
      ...overrides,
    };
  }

  async function applyToVacancy(
    applyToken: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{
    name: string;
    email: string;
    skills: string[];
    experience: string;
    projects: string[];
    summary: string;
  }> {
    const payload = applicationPayload(overrides);
    await request(testApp.app.getHttpServer())
      .post(`/apply/${applyToken}`)
      .send(payload)
      .expect(201);
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
        skills: applicant.skills,
        experience: applicant.experience,
        projects: applicant.projects,
        summary: applicant.summary,
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
});
