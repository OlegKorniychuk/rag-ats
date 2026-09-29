import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import {
  createVacancy,
  getVacancy,
  listVacancies,
  updateVacancy,
} from './vacancies';

const baseUrl = 'http://localhost:3000';

const vacancy = {
  id: '1',
  recruiterId: 'r1',
  title: 'Engineer',
  requirements: 'TS',
  applyToken: 'tok',
  status: 'open',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('vacancies api', () => {
  it('listVacancies gets /vacancies', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies`, () => HttpResponse.json([vacancy])),
    );
    const result = await listVacancies();
    expect(result).toEqual([vacancy]);
  });

  it('createVacancy posts to /vacancies with the body', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${baseUrl}/vacancies`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(vacancy, { status: 201 });
      }),
    );
    const result = await createVacancy({
      title: 'Engineer',
      requirements: 'TS',
    });
    expect(receivedBody).toEqual({ title: 'Engineer', requirements: 'TS' });
    expect(result).toEqual(vacancy);
  });

  it('getVacancy gets /vacancies/:id', async () => {
    server.use(
      http.get(`${baseUrl}/vacancies/1`, () => HttpResponse.json(vacancy)),
    );
    const result = await getVacancy('1');
    expect(result).toEqual(vacancy);
  });

  it('updateVacancy patches /vacancies/:id with the body', async () => {
    let receivedBody: unknown;
    server.use(
      http.patch(`${baseUrl}/vacancies/1`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ...vacancy, status: 'closed' });
      }),
    );
    const result = await updateVacancy('1', { status: 'closed' });
    expect(receivedBody).toEqual({ status: 'closed' });
    expect(result).toEqual({ ...vacancy, status: 'closed' });
  });
});
