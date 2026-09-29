import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import {
  listVacancyApplications,
  updateApplicationStage,
} from './applications';

const baseUrl = 'http://localhost:3000';

const candidate = {
  id: 'c1',
  name: 'Ada',
  email: 'ada@example.com',
  githubUrl: null,
  portfolioUrl: null,
  skills: ['TS'],
  experience: '3 years',
  projects: ['Analytical Engine'],
  summary: 'Great',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const application = {
  id: 'a1',
  vacancyId: 'v1',
  candidateId: 'c1',
  stage: 'applied',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('applications api', () => {
  it('listVacancyApplications gets /vacancies/:id/applications', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/v1/applications`, () =>
        HttpResponse.json([{ ...application, candidate }]),
      ),
    );
    const result = await listVacancyApplications('v1');
    expect(result).toEqual([{ ...application, candidate }]);
  });

  it('updateApplicationStage patches /applications/:id with the stage', async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(`${baseUrl}/applications/a1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ...application, stage: 'screened' });
      }),
    );
    const result = await updateApplicationStage('a1', 'screened');
    expect(receivedBody).toEqual({ stage: 'screened' });
    expect(result).toEqual({ ...application, stage: 'screened' });
  });
});
