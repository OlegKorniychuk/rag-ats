import { randomUUID } from 'crypto';
import request from 'supertest';
import { CV_MAX_SIZE_BYTES } from '../src/cv/cv.constants.js';
import { CV_PROFILE_SCHEMA_NAME } from '../src/llm/cv-profile.schema.js';
import { server } from './msw/server.js';
import {
  captureOpenaiRequests,
  openaiProfileHandler,
  openaiRefusalHandler,
} from './msw/openai.handlers.js';
import { applyWithCv, fixtureBytes, fixturePath } from './apply.util.js';
import { closeTestApp, createTestApp, type TestApp } from './e2e-app.util.js';

function uniqueEmail(): string {
  return `${randomUUID()}@example.com`;
}

describe('Apply (e2e)', () => {
  let testApp: TestApp;
  // counts CV parse calls only (scoring and embedding use other requests)
  const parseCapture = captureOpenaiRequests(CV_PROFILE_SCHEMA_NAME);

  beforeAll(async () => {
    testApp = await createTestApp();
    server.events.on('request:start', parseCapture.listener);
  }, 60_000);

  afterEach(() => {
    parseCapture.bodies.length = 0;
  });

  afterAll(async () => {
    server.events.removeListener('request:start', parseCapture.listener);
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

  async function createVacancy(
    agent: Awaited<ReturnType<typeof authenticatedAgent>>,
  ): Promise<{ id: string; applyToken: string }> {
    const res = await agent
      .post('/vacancies')
      .send({
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
      })
      .expect(201);
    return {
      id: res.body.id as string,
      applyToken: res.body.applyToken as string,
    };
  }

  describe('GET /apply/:token', () => {
    it('returns role details for a valid token, no auth required', async () => {
      const agent = await authenticatedAgent();
      const { applyToken } = await createVacancy(agent);

      const res = await request(testApp.app.getHttpServer())
        .get(`/apply/${applyToken}`)
        .expect(200);

      expect(res.body).toEqual({
        title: 'Senior Backend Engineer',
        requirements: '5+ years Node.js, PostgreSQL',
        status: 'open',
      });
    });

    it('returns 404 for an unknown token', async () => {
      await request(testApp.app.getHttpServer())
        .get(`/apply/${randomUUID()}`)
        .expect(404);
    });

    it('still resolves for a closed vacancy', async () => {
      const agent = await authenticatedAgent();
      const { id, applyToken } = await createVacancy(agent);
      await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'closed' })
        .expect(200);

      const res = await request(testApp.app.getHttpServer())
        .get(`/apply/${applyToken}`)
        .expect(200);

      expect(res.body.status).toBe('closed');
    });
  });

  describe('POST /apply/:token', () => {
    async function openVacancy(): Promise<{ id: string; applyToken: string }> {
      return createVacancy(await authenticatedAgent());
    }

    async function candidateRows(email: string) {
      return testApp.testDb.db.query.candidates.findMany({
        where: { email: email.toLowerCase() },
      });
    }

    // Parsing runs async in the background; DB-level assertions on the profile
    // must wait for it to settle (or hold it) to stay deterministic.
    async function waitForParsed(candidateId: string) {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const row = await testApp.testDb.db.query.candidates.findFirst({
          where: { id: candidateId },
        });
        if (row?.parseStatus === 'parsed') return row;
        if (Date.now() > deadline) {
          throw new Error(`Timed out; last status: ${row?.parseStatus}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    async function cvRows(candidateId: string) {
      return testApp.testDb.db.query.cvDocuments.findMany({
        where: { candidateId },
      });
    }

    it('creates a candidate, a CV document and an application', async () => {
      const { id: vacancyId, applyToken } = await openVacancy();
      const email = uniqueEmail();

      const res = await applyWithCv(testApp.app, applyToken, {
        name: 'Jane Applicant',
        email,
        githubUrl: 'https://github.com/jane',
      }).expect(201);

      expect(res.body).toEqual({ success: true });

      const candidates = await candidateRows(email);
      expect(candidates).toHaveLength(1);
      const candidate = candidates[0];
      expect(candidate).toMatchObject({
        name: 'Jane Applicant',
        githubUrl: 'https://github.com/jane',
        parseStatus: expect.stringMatching(/^(pending|parsing|parsed)$/),
      });

      const cvs = await cvRows(candidate.id);
      expect(cvs).toHaveLength(1);
      expect(cvs[0].filename).toBe('cv-text.pdf');
      expect(cvs[0].sizeBytes).toBe(fixtureBytes('cv-text.pdf').length);
      expect(cvs[0].content.equals(fixtureBytes('cv-text.pdf'))).toBe(true);
      expect(cvs[0].text).toContain('Jane Doe');

      const applications = await testApp.testDb.db.query.applications.findMany({
        where: { candidateId: candidate.id, vacancyId },
      });
      expect(applications).toHaveLength(1);
      expect(applications[0].stage).toBe('applied');
      expect(applications[0].source).toBe('applied');

      const score = await testApp.testDb.db.query.applicationScores.findFirst({
        where: { applicationId: applications[0].id },
      });
      expect(score).toMatchObject({ status: 'pending', result: null });
    });

    it('reuses a repeat candidate: adds a CV, updates name and links, keeps the profile', async () => {
      const first = await openVacancy();
      const second = await openVacancy();
      const email = uniqueEmail();

      await applyWithCv(testApp.app, first.applyToken, {
        name: 'Old Name',
        email,
        githubUrl: 'https://github.com/old',
        portfolioUrl: 'https://old.dev',
      }).expect(201);

      const [before] = await candidateRows(email);
      await waitForParsed(before.id);
      const profile = {
        skills: ['TypeScript'],
        projects: ['Project A'],
        experience: 'Existing experience',
        summary: 'Existing summary',
      };
      const { candidates } = await import('../src/db/schema.js');
      const { eq } = await import('drizzle-orm');
      await testApp.testDb.db
        .update(candidates)
        .set(profile)
        .where(eq(candidates.id, before.id));

      // Hold the second parse so the old profile is observable while pending.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      server.use(
        openaiProfileHandler(
          { skills: ['Replaced'], experience: '', projects: [], summary: '' },
          { before: () => gate },
        ),
      );

      await applyWithCv(testApp.app, second.applyToken, {
        name: 'New Name',
        email: `  ${email.toUpperCase()} `,
        githubUrl: 'https://github.com/new',
      }).expect(201);

      const rows = await candidateRows(email);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: before.id,
        name: 'New Name',
        githubUrl: 'https://github.com/new',
        portfolioUrl: 'https://old.dev',
        ...profile,
      });
      expect(rows[0].parseStatus).toMatch(/^(pending|parsing)$/);
      expect(await cvRows(before.id)).toHaveLength(2);
      release();
      await waitForParsed(before.id);

      const applications = await testApp.testDb.db.query.applications.findMany({
        where: { candidateId: before.id },
      });
      expect(applications).toHaveLength(2);
    });

    describe('repeat applicant re-sending a CV', () => {
      async function waitForCandidateStatus(
        candidateId: string,
        status: 'parsed' | 'failed',
      ) {
        const deadline = Date.now() + 10_000;
        for (;;) {
          const row = await testApp.testDb.db.query.candidates.findFirst({
            where: { id: candidateId },
          });
          if (row?.parseStatus === status) return row;
          if (Date.now() > deadline) {
            throw new Error(
              `Timed out waiting for '${status}'; last status: ${row?.parseStatus}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      async function waitForScored(applicationId: string) {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const score =
            await testApp.testDb.db.query.applicationScores.findFirst({
              where: { applicationId },
            });
          if (score?.status === 'scored') return score;
          if (Date.now() > deadline) {
            throw new Error(
              `Timed out waiting for scored; last status: ${score?.status}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      async function applicationFor(vacancyId: string, candidateId: string) {
        const row = await testApp.testDb.db.query.applications.findFirst({
          where: { vacancyId, candidateId },
        });
        expect(row).toBeDefined();
        return row!;
      }

      // first application, parsed to completion, then the capture is cleared
      async function parsedCandidate(
        fields: { email: string; githubUrl?: string },
        fixture = 'cv-text.pdf',
      ) {
        const first = await openVacancy();
        await applyWithCv(
          testApp.app,
          first.applyToken,
          { name: 'Jane Applicant', ...fields },
          fixture,
        ).expect(201);
        const [candidate] = await candidateRows(fields.email);
        await waitForCandidateStatus(candidate.id, 'parsed');
        parseCapture.bodies.length = 0;
        return candidate;
      }

      it('reuses the CV and skips the parse for an identical PDF and unchanged GitHub URL', async () => {
        const email = uniqueEmail();
        const githubUrl = 'https://github.com/jane';
        const candidate = await parsedCandidate({ email, githubUrl });
        const before = await cvRows(candidate.id);
        const second = await openVacancy();

        // same bytes under a different file name: the hash decides, not the name
        await applyWithCv(
          testApp.app,
          second.applyToken,
          { name: 'Jane Renamed', email, githubUrl },
          'cv-text.pdf',
          'renamed.pdf',
        ).expect(201);

        const afterApply = await candidateRows(email);
        expect(afterApply[0]).toMatchObject({
          id: candidate.id,
          name: 'Jane Renamed',
          parseStatus: 'parsed',
        });
        const application = await applicationFor(second.id, candidate.id);
        await waitForScored(application.id);

        const cvs = await cvRows(candidate.id);
        expect(cvs.map((c) => c.id)).toEqual(before.map((c) => c.id));
        expect(cvs[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(parseCapture.bodies).toHaveLength(0);
        expect((await candidateRows(email))[0].parseStatus).toBe('parsed');
      });

      it('also reuses the CV when the GitHub URL is omitted', async () => {
        const email = uniqueEmail();
        const candidate = await parsedCandidate({
          email,
          githubUrl: 'https://github.com/jane',
        });
        const second = await openVacancy();

        await applyWithCv(testApp.app, second.applyToken, {
          name: 'Jane Applicant',
          email,
        }).expect(201);

        const application = await applicationFor(second.id, candidate.id);
        await waitForScored(application.id);
        expect(await cvRows(candidate.id)).toHaveLength(1);
        expect(parseCapture.bodies).toHaveLength(0);
      });

      it('stores a new CV and re-parses when the PDF differs', async () => {
        const email = uniqueEmail();
        const candidate = await parsedCandidate({ email });
        const second = await openVacancy();

        await applyWithCv(
          testApp.app,
          second.applyToken,
          { name: 'Jane Applicant', email },
          'cv-text-2.pdf',
        ).expect(201);

        const application = await applicationFor(second.id, candidate.id);
        await waitForScored(application.id);

        const cvs = await cvRows(candidate.id);
        expect(cvs).toHaveLength(2);
        expect(new Set(cvs.map((c) => c.contentSha256)).size).toBe(2);
        expect(parseCapture.bodies).toHaveLength(1);
      });

      it('re-parses an identical PDF when the GitHub URL changed', async () => {
        const email = uniqueEmail();
        const candidate = await parsedCandidate({
          email,
          githubUrl: 'https://github.com/jane',
        });
        const second = await openVacancy();

        await applyWithCv(testApp.app, second.applyToken, {
          name: 'Jane Applicant',
          email,
          githubUrl: 'https://github.com/jane-new',
        }).expect(201);

        const application = await applicationFor(second.id, candidate.id);
        await waitForScored(application.id);

        expect(await cvRows(candidate.id)).toHaveLength(2);
        expect(parseCapture.bodies).toHaveLength(1);
      });

      it('re-parses an identical PDF when the previous parse failed', async () => {
        const email = uniqueEmail();
        server.use(openaiRefusalHandler());
        const first = await openVacancy();
        await applyWithCv(testApp.app, first.applyToken, {
          name: 'Jane Applicant',
          email,
        }).expect(201);
        const [candidate] = await candidateRows(email);
        await waitForCandidateStatus(candidate.id, 'failed');
        server.resetHandlers();
        parseCapture.bodies.length = 0;
        const second = await openVacancy();

        await applyWithCv(testApp.app, second.applyToken, {
          name: 'Jane Applicant',
          email,
        }).expect(201);

        await waitForCandidateStatus(candidate.id, 'parsed');
        const application = await applicationFor(second.id, candidate.id);
        await waitForScored(application.id);
        expect(await cvRows(candidate.id)).toHaveLength(2);
        expect(parseCapture.bodies).toHaveLength(1);
      });
    });

    it('stores a UTF-8 filename intact', async () => {
      const { applyToken } = await openVacancy();
      const email = uniqueEmail();

      await request(testApp.app.getHttpServer())
        .post(`/apply/${applyToken}`)
        .field('name', 'Jane Applicant')
        .field('email', email)
        .attach('cv', fixturePath('cv-text.pdf'), 'résumé.pdf')
        .expect(201);

      const [candidate] = await candidateRows(email);
      const [cv] = await cvRows(candidate.id);
      expect(cv.filename).toBe('résumé.pdf');
    });

    it('returns 409 for a duplicate application and writes no extra CV', async () => {
      const { applyToken } = await openVacancy();
      const email = uniqueEmail();
      const fields = { name: 'Jane Applicant', email };

      await applyWithCv(testApp.app, applyToken, fields).expect(201);
      await applyWithCv(testApp.app, applyToken, fields).expect(409);

      const [candidate] = await candidateRows(email);
      expect(await cvRows(candidate.id)).toHaveLength(1);
    });

    it('returns 404 for an unknown token', async () => {
      await applyWithCv(testApp.app, randomUUID(), {
        name: 'Jane Applicant',
        email: uniqueEmail(),
      }).expect(404);
    });

    it('returns 409 for a closed vacancy and writes nothing', async () => {
      const agent = await authenticatedAgent();
      const { id, applyToken } = await createVacancy(agent);
      await agent
        .patch(`/vacancies/${id}`)
        .send({ status: 'closed' })
        .expect(200);
      const email = uniqueEmail();

      await applyWithCv(testApp.app, applyToken, {
        name: 'Jane Applicant',
        email,
      }).expect(409);

      expect(await candidateRows(email)).toHaveLength(0);
    });

    describe('validation', () => {
      let applyToken: string;

      beforeAll(async () => {
        ({ applyToken } = await openVacancy());
      });

      it('rejects a missing CV', async () => {
        const res = await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .field('name', 'Jane Applicant')
          .field('email', uniqueEmail())
          .expect(400);
        expect(res.body.message).toBe('CV file is required');
      });

      it('rejects a non-PDF file even when sent as application/pdf', async () => {
        const res = await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .field('name', 'Jane Applicant')
          .field('email', uniqueEmail())
          .attach('cv', fixturePath('not-a-pdf.pdf'), {
            contentType: 'application/pdf',
          })
          .expect(400);
        expect(res.body.message).toBe('CV must be a PDF file');
      });

      it('rejects a PDF with no readable text', async () => {
        const res = await applyWithCv(
          testApp.app,
          applyToken,
          { name: 'Jane Applicant', email: uniqueEmail() },
          'cv-empty.pdf',
        ).expect(400);
        expect(res.body.message).toBe('Could not read text from the CV PDF');
      });

      it('rejects a CV over 5 MB with 413', async () => {
        const big = Buffer.alloc(CV_MAX_SIZE_BYTES + 1);
        big.write('%PDF-');

        await request(testApp.app.getHttpServer())
          .post(`/apply/${applyToken}`)
          .field('name', 'Jane Applicant')
          .field('email', uniqueEmail())
          .attach('cv', big, 'big.pdf')
          .expect(413);
      });

      it('rejects a missing name', async () => {
        await applyWithCv(testApp.app, applyToken, {
          email: uniqueEmail(),
        }).expect(400);
      });

      it('rejects an invalid email', async () => {
        await applyWithCv(testApp.app, applyToken, {
          name: 'Jane Applicant',
          email: 'not-an-email',
        }).expect(400);
      });

      it('rejects an invalid githubUrl', async () => {
        await applyWithCv(testApp.app, applyToken, {
          name: 'Jane Applicant',
          email: uniqueEmail(),
          githubUrl: 'not-a-url',
        }).expect(400);
      });

      it('rejects an unknown extra field', async () => {
        await applyWithCv(testApp.app, applyToken, {
          name: 'Jane Applicant',
          email: uniqueEmail(),
          notAField: 'surprise',
        }).expect(400);
      });
    });
  });
});
