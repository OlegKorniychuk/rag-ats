import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { bootstrapSession } from './bootstrapSession';
import { useSessionStore } from './sessionStore';

const baseUrl = 'http://localhost:3000';

describe('bootstrapSession', () => {
  beforeEach(() => {
    useSessionStore.setState({ status: 'loading', user: null });
  });

  it('sets authenticated with the user on success', async () => {
    const user = { id: '1', email: 'a@b.com' };
    server.use(http.get(`${baseUrl}/auth/me`, () => HttpResponse.json(user)));
    await bootstrapSession();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'authenticated',
      user,
    });
  });

  it('sets anonymous on a 401', async () => {
    server.use(
      http.get(
        `${baseUrl}/auth/me`,
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    await bootstrapSession();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
  });

  it('sets anonymous on a network error', async () => {
    server.use(http.get(`${baseUrl}/auth/me`, () => HttpResponse.error()));
    await bootstrapSession();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
  });
});
