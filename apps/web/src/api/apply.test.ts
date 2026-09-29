import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { getPublicVacancy, submitApplication } from './apply';

const baseUrl = 'http://localhost:3000';

const vacancy = {
  title: 'Backend Dev',
  requirements: 'TS',
  status: 'open',
};

describe('apply api', () => {
  it('getPublicVacancy gets /apply/:token', async () => {
    server.use(
      http.get(`${baseUrl}/apply/tok-123`, () => HttpResponse.json(vacancy)),
    );
    const result = await getPublicVacancy('tok-123');
    expect(result).toEqual(vacancy);
  });

  it('submitApplication posts to /apply/:token with the body', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${baseUrl}/apply/tok-123`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    const body = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      skills: ['TS'],
      experience: '3 years',
      projects: ['Project A'],
      summary: 'Great candidate',
    };
    const result = await submitApplication('tok-123', body);
    expect(receivedBody).toEqual(body);
    expect(result).toEqual({ success: true });
  });
});
