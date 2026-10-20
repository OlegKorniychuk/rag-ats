import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { EnvConfig } from '../config/env.config.js';
import {
  GITHUB_API,
  captureGithubRequests,
  githubHandlers,
  githubRateLimitHandler,
  githubSlowUserHandler,
} from '../../test/msw/github.handlers.js';
import {
  GithubClient,
  GithubNotFoundError,
  GithubUnavailableError,
} from './github-client.js';

const server = setupServer();
const capture = captureGithubRequests();

function makeClient(token?: string) {
  return new GithubClient({ GITHUB_TOKEN: token } as EnvConfig);
}

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', capture.listener);
});
afterEach(() => {
  server.resetHandlers();
  capture.requests.length = 0;
});
afterAll(() => server.close());

describe('GithubClient', () => {
  it('sends the standard headers and no Authorization without a token', async () => {
    server.use(...githubHandlers());

    await makeClient().getUser('janedoe');

    const { headers, path } = capture.requests[0];
    expect(path).toBe('/users/janedoe');
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(headers.get('user-agent')).toBe('rag-ats');
    expect(headers.has('authorization')).toBe(false);
  });

  it.each([undefined, '', '   '])('treats token %j as unset', async (token) => {
    server.use(...githubHandlers());

    await makeClient(token).getUser('janedoe');

    expect(capture.requests[0].headers.has('authorization')).toBe(false);
  });

  it('sends the bearer token on every call when configured', async () => {
    server.use(...githubHandlers());
    const client = makeClient('ghp_secret');

    await client.getUser('janedoe');
    await client.listOwnerRepos('janedoe');
    await client.getReadme('janedoe', 'charlie');

    expect(capture.requests).toHaveLength(3);
    for (const { headers } of capture.requests) {
      expect(headers.get('authorization')).toBe('Bearer ghp_secret');
    }
  });

  it('lists owned repos sorted by push date, 100 per page', async () => {
    server.use(...githubHandlers());

    const repos = await makeClient().listOwnerRepos('janedoe');

    expect(repos.length).toBeGreaterThan(0);
    const params = new URLSearchParams(capture.requests[0].search);
    expect(Object.fromEntries(params)).toEqual({
      type: 'owner',
      sort: 'pushed',
      per_page: '100',
    });
  });

  it('requests the raw README media type', async () => {
    server.use(...githubHandlers());

    const text = await makeClient().getReadme('janedoe', 'charlie');

    expect(text).toContain('Charlie');
    expect(capture.requests[0].path).toBe('/repos/janedoe/charlie/readme');
    expect(capture.requests[0].headers.get('accept')).toBe(
      'application/vnd.github.raw',
    );
  });

  it('returns null for a missing README', async () => {
    server.use(...githubHandlers());

    await expect(
      makeClient().getReadme('janedoe', 'alpha'),
    ).resolves.toBeNull();
  });

  it('percent-encodes path segments', async () => {
    server.use(http.get(`${GITHUB_API}/users/:u`, () => HttpResponse.json({})));

    await expect(makeClient().getUser('a/../b?x#y')).rejects.toBeInstanceOf(
      GithubUnavailableError,
    );

    expect(capture.requests[0].path).toBe('/users/a%2F..%2Fb%3Fx%23y');
    expect(capture.requests[0].search).toBe('');
  });

  it('throws GithubNotFoundError on 404', async () => {
    server.use(
      http.get(`${GITHUB_API}/users/:u`, () =>
        HttpResponse.json({}, { status: 404 }),
      ),
    );

    await expect(makeClient().getUser('ghost')).rejects.toBeInstanceOf(
      GithubNotFoundError,
    );
  });

  it('throws GithubUnavailableError with the status on rate limit', async () => {
    server.use(githubRateLimitHandler());

    await expect(makeClient().getUser('janedoe')).rejects.toMatchObject({
      name: 'GithubUnavailableError',
      status: 403,
    });
  });

  it('aborts after the configured timeout', async () => {
    server.use(githubSlowUserHandler(300));
    const client = makeClient();
    client.timeoutMs = 50;

    await expect(client.getUser('janedoe')).rejects.toMatchObject({
      name: 'GithubUnavailableError',
      reason: 'timeout',
    });
  });

  it('never puts the token in error messages', async () => {
    server.use(githubRateLimitHandler());

    const error = await makeClient('ghp_secret')
      .getUser('janedoe')
      .catch((e: Error) => e);

    expect((error as Error).message).not.toContain('ghp_secret');
  });
});
