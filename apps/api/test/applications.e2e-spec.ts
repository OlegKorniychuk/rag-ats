import { randomUUID } from 'crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Applications (e2e)', () => {
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
  ): Promise<{ name: string; email: string }> {
    const payload = applicationPayload(overrides);
    await request(testApp.app.getHttpServer())
      .post(`/apply/${applyToken}`)
      .send(payload)
      .expect(201);
    return { name: payload.name, email: payload.email };
  }

  async function findApplicationId(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    vacancyId: string,
    email: string,
  ): Promise<string> {
    const res = await agent
      .get(`/vacancies/${vacancyId}/applications`)
      .expect(200);
    const match = (
      res.body as { id: string; candidate: { email: string } }[]
    ).find((a) => a.candidate.email === email.toLowerCase());
    if (!match) throw new Error('application not found in list');
    return match.id;
  }

  async function getStage(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
    vacancyId: string,
    applicationId: string,
  ): Promise<string> {
    const res = await agent
      .get(`/vacancies/${vacancyId}/applications`)
      .expect(200);
    const match = (res.body as { id: string; stage: string }[]).find(
      (a) => a.id === applicationId,
    );
    if (!match) throw new Error('application not found in list');
    return match.stage;
  }

  describe('PATCH /applications/:id', () => {
    it('moves an application through stages for the owning recruiter', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      const res = await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'screened' })
        .expect(200);
      expect(res.body.stage).toBe('screened');

      const res2 = await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'hired' })
        .expect(200);
      expect(res2.body.stage).toBe('hired');
    });

    it('allows skipping stages with no order restriction', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      const res = await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'interview' })
        .expect(200);
      expect(res.body.stage).toBe('interview');
    });

    it('reflects the new stage via GET /vacancies/:id/applications', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'rejected' })
        .expect(200);

      const stage = await getStage(agent, vacancyId, applicationId);
      expect(stage).toBe('rejected');
    });

    it('rejects an invalid stage value', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'archived' })
        .expect(400);
    });

    it('rejects a missing stage field', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      await agent.patch(`/applications/${applicationId}`).send({}).expect(400);
    });

    it('rejects an unknown extra field', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      await agent
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'screened', note: 'nope' })
        .expect(400);
    });

    it('rejects a non-owner with 404 and leaves the stage unchanged', async () => {
      const owner = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(owner);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        owner,
        vacancyId,
        applicant.email,
      );
      const otherRecruiter = await authenticatedAgent();

      await otherRecruiter
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'hired' })
        .expect(404);

      const stage = await getStage(owner, vacancyId, applicationId);
      expect(stage).toBe('applied');
    });

    it('returns 404 for an unknown id', async () => {
      const agent = await authenticatedAgent();

      await agent
        .patch(`/applications/${randomUUID()}`)
        .send({ stage: 'screened' })
        .expect(404);
    });

    it('rejects a malformed id', async () => {
      const agent = await authenticatedAgent();

      await agent
        .patch('/applications/not-a-uuid')
        .send({ stage: 'screened' })
        .expect(400);
    });

    it('rejects a request with no session cookie', async () => {
      const agent = await authenticatedAgent();
      const { id: vacancyId, applyToken } = await createVacancyWithToken(agent);
      const applicant = await applyToVacancy(applyToken);
      const applicationId = await findApplicationId(
        agent,
        vacancyId,
        applicant.email,
      );

      await request(testApp.app.getHttpServer())
        .patch(`/applications/${applicationId}`)
        .send({ stage: 'screened' })
        .expect(401);
    });
  });
});
