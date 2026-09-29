import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { ApiError, apiFetch, setUnauthorizedHandler } from './client';

const baseUrl = 'http://localhost:3000';

describe('apiFetch', () => {
  it('returns parsed JSON on success', async () => {
    server.use(
      http.get(`${baseUrl}/users`, () => HttpResponse.json({ id: 1 })),
    );
    await expect(apiFetch<{ id: number }>('/users')).resolves.toEqual({
      id: 1,
    });
  });

  it('returns text on non-JSON success', async () => {
    server.use(
      http.get(`${baseUrl}/`, () => new HttpResponse('ok', { status: 200 })),
    );
    await expect(apiFetch<string>('/')).resolves.toBe('ok');
  });

  it('returns undefined on 204', async () => {
    server.use(
      http.delete(
        `${baseUrl}/sessions`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(
      apiFetch('/sessions', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('sends a JSON body and content-type when json option is given', async () => {
    let receivedContentType: string | null = null;
    let receivedBody: unknown;
    server.use(
      http.post(`${baseUrl}/login`, async ({ request }) => {
        receivedContentType = request.headers.get('content-type');
        receivedBody = await request.json();
        return HttpResponse.json({ success: true });
      }),
    );
    await apiFetch('/login', { method: 'POST', json: { email: 'a@b.com' } });
    expect(receivedContentType).toContain('application/json');
    expect(receivedBody).toEqual({ email: 'a@b.com' });
  });

  it('sends the request with credentials include', async () => {
    server.use(http.get(`${baseUrl}/me`, () => HttpResponse.json({})));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await apiFetch('/me');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' }),
    );
    fetchSpy.mockRestore();
  });

  it('normalizes a string message into an ApiError', async () => {
    server.use(
      http.get(`${baseUrl}/private`, () =>
        HttpResponse.json(
          { statusCode: 401, message: 'Unauthorized' },
          { status: 401 },
        ),
      ),
    );
    const error = await apiFetch('/private').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, messages: ['Unauthorized'] });
    expect((error as ApiError).message).toBe('Unauthorized');
  });

  it('normalizes an array message into an ApiError', async () => {
    server.use(
      http.post(`${baseUrl}/register`, () =>
        HttpResponse.json(
          { statusCode: 400, message: ['a', 'b'] },
          { status: 400 },
        ),
      ),
    );
    const error = await apiFetch('/register', { method: 'POST' }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, messages: ['a', 'b'] });
    expect((error as ApiError).message).toBe('a, b');
  });

  it('falls back to statusText for a non-JSON error body', async () => {
    server.use(
      http.get(
        `${baseUrl}/boom`,
        () =>
          new HttpResponse('server exploded', {
            status: 500,
            statusText: 'Internal Server Error',
          }),
      ),
    );
    const error = await apiFetch('/boom').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 500,
      messages: ['Internal Server Error'],
    });
  });

  describe('unauthorized handler', () => {
    afterEach(() => {
      setUnauthorizedHandler(null);
    });

    it('calls the handler on a 401 for a non-login path', async () => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      server.use(
        http.get(
          `${baseUrl}/secret`,
          () => new HttpResponse(null, { status: 401 }),
        ),
      );
      await apiFetch('/secret').catch(() => {});
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not call the handler on a 401 for /auth/login', async () => {
      const handler = vi.fn();
      setUnauthorizedHandler(handler);
      server.use(
        http.post(
          `${baseUrl}/auth/login`,
          () => new HttpResponse(null, { status: 401 }),
        ),
      );
      await apiFetch('/auth/login', { method: 'POST' }).catch(() => {});
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
