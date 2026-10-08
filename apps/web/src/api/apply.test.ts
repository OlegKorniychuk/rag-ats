import { describe, expect, it, vi } from 'vitest';
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

  it('submitApplication posts multipart form data to /apply/:token', async () => {
    let form: FormData | undefined;
    let contentType: string | null = null;
    server.use(
      http.post(`${baseUrl}/apply/tok-123`, async ({ request }) => {
        contentType = request.headers.get('content-type');
        form = await request.formData();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    const append = vi.spyOn(FormData.prototype, 'append');
    const result = await submitApplication('tok-123', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      portfolioUrl: 'https://jane.dev',
      cv: new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }),
    });
    expect(contentType).toContain('multipart/form-data');
    expect(form?.get('name')).toBe('Jane Doe');
    expect(form?.get('email')).toBe('jane@example.com');
    expect(form?.get('portfolioUrl')).toBe('https://jane.dev');
    expect(form?.has('githubUrl')).toBe(false);
    // jsdom's File loses its filename when serialized by the Node fetch layer,
    // so assert the filename passed to FormData and the received part's type.
    expect(append).toHaveBeenCalledWith('cv', expect.any(File), 'cv.pdf');
    append.mockRestore();
    expect((form?.get('cv') as Blob).type).toBe('application/pdf');
    expect(result).toEqual({ success: true });
  });
});
