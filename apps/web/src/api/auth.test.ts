import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { getMe, login, logout, register } from './auth';

const baseUrl = 'http://localhost:3000';

describe('auth api', () => {
  it('register posts to /auth/register with the body', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${baseUrl}/auth/register`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json(
          { id: '1', email: 'a@b.com' },
          { status: 201 },
        );
      }),
    );
    const result = await register({ email: 'a@b.com', password: 'secret' });
    expect(receivedBody).toEqual({ email: 'a@b.com', password: 'secret' });
    expect(result).toEqual({ id: '1', email: 'a@b.com' });
  });

  it('login posts to /auth/login with the body', async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${baseUrl}/auth/login`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ success: true }, { status: 201 });
      }),
    );
    const result = await login({ email: 'a@b.com', password: 'secret' });
    expect(receivedBody).toEqual({ email: 'a@b.com', password: 'secret' });
    expect(result).toEqual({ success: true });
  });

  it('logout posts to /auth/logout', async () => {
    server.use(
      http.post(`${baseUrl}/auth/logout`, () =>
        HttpResponse.json({ success: true }, { status: 201 }),
      ),
    );
    const result = await logout();
    expect(result).toEqual({ success: true });
  });

  it('getMe gets /auth/me', async () => {
    server.use(
      http.get(`${baseUrl}/auth/me`, () =>
        HttpResponse.json({ id: '1', email: 'a@b.com' }),
      ),
    );
    const result = await getMe();
    expect(result).toEqual({ id: '1', email: 'a@b.com' });
  });
});
