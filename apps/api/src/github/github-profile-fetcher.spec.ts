import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import type { EnvConfig } from '../config/env.config.js';
import {
  GITHUB_API,
  GITHUB_REPOS_FIXTURE,
  GITHUB_USERNAME,
  GITHUB_USER_FIXTURE,
  LONG_README,
  MESSY_README_CLEANED,
  captureGithubRequests,
  githubHandlers,
  githubInvalidJsonHandler,
  githubNetworkErrorHandler,
  githubRateLimitHandler,
  githubServerErrorHandler,
  githubSlowUserHandler,
  githubTooManyRequestsHandler,
  githubUserNotFoundHandler,
} from '../../test/msw/github.handlers.js';
import { GithubClient } from './github-client.js';
import {
  GithubProfileFetcher,
  README_MAX_CHARS,
} from './github-profile-fetcher.js';

const TOKEN = 'ghp_super_secret_token';
const server = setupServer();
const capture = captureGithubRequests();

function makeFetcher(token?: string, timeoutMs?: number) {
  const client = new GithubClient({ GITHUB_TOKEN: token } as EnvConfig);
  if (timeoutMs !== undefined) client.timeoutMs = timeoutMs;
  return new GithubProfileFetcher(client);
}

function readmePaths() {
  return capture.requests
    .map((r) => r.path)
    .filter((p) => p.endsWith('/readme'))
    .sort();
}

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', capture.listener);
});
beforeEach(() => {
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  errorSpy = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
});
afterEach(() => {
  server.resetHandlers();
  capture.requests.length = 0;
  jest.restoreAllMocks();
});
afterAll(() => server.close());

describe('GithubProfileFetcher', () => {
  describe('ok snapshot', () => {
    beforeEach(() => server.use(...githubHandlers()));

    it('maps the user and repos', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot).toMatchObject({
        username: GITHUB_USER_FIXTURE.login,
        profileUrl: GITHUB_USER_FIXTURE.html_url,
        status: 'ok',
        bio: GITHUB_USER_FIXTURE.bio,
      });
      expect(new Date(snapshot.fetchedAt).toISOString()).toBe(
        snapshot.fetchedAt,
      );
      const alpha = snapshot.repos.find((r) => r.name === 'alpha');
      expect(alpha).toEqual({
        name: 'alpha',
        url: `https://github.com/${GITHUB_USERNAME}/alpha`,
        description: 'alpha description',
        language: 'TypeScript',
        stars: 50,
        topics: ['nestjs', 'api'],
        pushedAt: '2026-03-01T00:00:00Z',
        readmeExcerpt: null,
      });
    });

    it('excludes forks and archived repos and orders by stars then push date, max 6', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot.repos.map((r) => r.name)).toEqual([
        'charlie', // 200
        'bravo', // 50, pushed later than alpha
        'alpha', // 50
        'delta', // 10
        'echo', // 5
        'foxtrot', // 3
      ]);
    });

    it('defaults missing topics to an empty list', async () => {
      server.use(
        ...githubHandlers({
          repos: GITHUB_REPOS_FIXTURE.map((r) => ({ ...r, topics: undefined })),
        }),
      );

      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot.repos.every((r) => r.topics.length === 0)).toBe(true);
    });

    it('aggregates primary languages over all owned non-fork repos, archived included', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      // Counts include repos cut by the top-6 limit (golf, hotel) and the
      // archived Go repo; the fork and the null-language repo are skipped.
      expect(snapshot.languages).toEqual([
        { name: 'TypeScript', repoCount: 3 },
        { name: 'Go', repoCount: 2 },
        { name: 'Python', repoCount: 2 },
        { name: 'Rust', repoCount: 1 },
      ]);
    });

    it('fetches READMEs only for the top 3 selected repos', async () => {
      await makeFetcher().fetch(GITHUB_USERNAME);

      expect(readmePaths()).toEqual([
        `/repos/${GITHUB_USERNAME}/alpha/readme`,
        `/repos/${GITHUB_USERNAME}/bravo/readme`,
        `/repos/${GITHUB_USERNAME}/charlie/readme`,
      ]);
    });

    it('strips images, badges and HTML from READMEs', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      const charlie = snapshot.repos.find((r) => r.name === 'charlie');
      expect(charlie?.readmeExcerpt).toBe(MESSY_README_CLEANED);
    });

    it('trims READMEs to 3000 characters', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      const bravo = snapshot.repos.find((r) => r.name === 'bravo');
      expect(LONG_README.length).toBeGreaterThan(README_MAX_CHARS);
      expect(bravo?.readmeExcerpt).toHaveLength(README_MAX_CHARS);
      expect(LONG_README.startsWith(bravo?.readmeExcerpt ?? '?')).toBe(true);
    });

    it('uses null for missing READMEs and for repos beyond the top 3', async () => {
      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      const byName = Object.fromEntries(
        snapshot.repos.map((r) => [r.name, r.readmeExcerpt]),
      );
      expect(byName.alpha).toBeNull(); // 404
      expect(byName.delta).toBeNull(); // not requested
      expect(byName.foxtrot).toBeNull(); // not requested
    });

    it('treats a README server error as no README', async () => {
      server.use(
        http.get(`${GITHUB_API}/repos/${GITHUB_USERNAME}/charlie/readme`, () =>
          HttpResponse.text('boom', { status: 500 }),
        ),
      );

      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot.status).toBe('ok');
      expect(
        snapshot.repos.find((r) => r.name === 'charlie')?.readmeExcerpt,
      ).toBeNull();
      expect(
        snapshot.repos.find((r) => r.name === 'bravo')?.readmeExcerpt,
      ).not.toBeNull();
    });

    it('handles a user with no repos', async () => {
      server.use(...githubHandlers({ repos: [] }));

      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot).toMatchObject({
        status: 'ok',
        repos: [],
        languages: [],
      });
      expect(readmePaths()).toEqual([]);
    });
  });

  describe('failure statuses', () => {
    const failed = (username: string, status: 'not_found' | 'unavailable') => ({
      username,
      profileUrl: `https://github.com/${username}`,
      status,
      bio: null,
      repos: [],
      languages: [],
    });

    it('maps a missing user to not_found', async () => {
      server.use(githubUserNotFoundHandler());

      const snapshot = await makeFetcher().fetch('ghost');

      expect(snapshot).toMatchObject(failed('ghost', 'not_found'));
      expect(new Date(snapshot.fetchedAt).toISOString()).toBe(
        snapshot.fetchedAt,
      );
    });

    it.each([
      ['403 rate limit', githubRateLimitHandler],
      ['429', githubTooManyRequestsHandler],
      ['500', githubServerErrorHandler],
      ['network error', githubNetworkErrorHandler],
      ['invalid JSON', githubInvalidJsonHandler],
    ])('maps %s to unavailable without throwing', async (_label, handler) => {
      server.use(handler());

      const snapshot = await makeFetcher().fetch('janedoe');

      expect(snapshot).toMatchObject(failed('janedoe', 'unavailable'));
    });

    it('maps a timeout to unavailable', async () => {
      server.use(githubSlowUserHandler(300));

      const snapshot = await makeFetcher(undefined, 50).fetch('janedoe');

      expect(snapshot).toMatchObject(failed('janedoe', 'unavailable'));
    });

    it('maps a failing repo listing to unavailable', async () => {
      server.use(
        http.get(`${GITHUB_API}/users/${GITHUB_USERNAME}`, () =>
          HttpResponse.json(GITHUB_USER_FIXTURE),
        ),
        http.get(`${GITHUB_API}/users/${GITHUB_USERNAME}/repos`, () =>
          HttpResponse.json({}, { status: 502 }),
        ),
      );

      const snapshot = await makeFetcher().fetch(GITHUB_USERNAME);

      expect(snapshot).toMatchObject(failed(GITHUB_USERNAME, 'unavailable'));
    });

    it('logs a warning with the username and reason', async () => {
      server.use(githubRateLimitHandler());

      await makeFetcher().fetch('janedoe');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = String(warnSpy.mock.calls[0][0]);
      expect(message).toContain('janedoe');
      expect(message).toContain('HTTP 403');
    });
  });

  describe('token', () => {
    it('sends Authorization only when a token is configured', async () => {
      server.use(...githubHandlers());

      await makeFetcher().fetch(GITHUB_USERNAME);
      expect(capture.requests.length).toBeGreaterThan(0);
      expect(
        capture.requests.every((r) => !r.headers.has('authorization')),
      ).toBe(true);

      capture.requests.length = 0;
      await makeFetcher(TOKEN).fetch(GITHUB_USERNAME);
      expect(capture.requests.length).toBeGreaterThan(0);
      expect(
        capture.requests.every(
          (r) => r.headers.get('authorization') === `Bearer ${TOKEN}`,
        ),
      ).toBe(true);
    });

    it.each([
      ['403', githubRateLimitHandler],
      ['429', githubTooManyRequestsHandler],
      ['500', githubServerErrorHandler],
      ['network error', githubNetworkErrorHandler],
      ['invalid JSON', githubInvalidJsonHandler],
      ['not found', githubUserNotFoundHandler],
    ])('never logs the token (%s)', async (_label, handler) => {
      server.use(handler());

      await makeFetcher(TOKEN).fetch('janedoe');

      const logged = [...warnSpy.mock.calls, ...errorSpy.mock.calls];
      expect(logged.length).toBeGreaterThan(0);
      expect(JSON.stringify(logged)).not.toContain(TOKEN);
    });

    it('never logs the token on a README failure', async () => {
      server.use(
        http.get(`${GITHUB_API}/repos/${GITHUB_USERNAME}/charlie/readme`, () =>
          HttpResponse.text('boom', { status: 500 }),
        ),
        ...githubHandlers(),
      );

      await makeFetcher(TOKEN).fetch(GITHUB_USERNAME);

      expect(warnSpy).toHaveBeenCalled();
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TOKEN);
    });
  });
});
