import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { EnvConfig } from '../config/env.config.js';
import {
  GITHUB_READMES_FIXTURE,
  GITHUB_REPOS_FIXTURE,
  GITHUB_USERNAME,
  GITHUB_USER_FIXTURE,
  githubHandlers,
} from '../../test/msw/github.handlers.js';
import {
  type GithubFixture,
  FixtureGithubClient,
} from './fixture-github-client.js';
import {
  GithubClient,
  GithubNotFoundError,
  GithubUnavailableError,
} from './github-client.js';
import { GithubProfileFetcher } from './github-profile-fetcher.js';

const config = {} as EnvConfig;
const FIXTURE: GithubFixture = {
  user: GITHUB_USER_FIXTURE,
  repos: GITHUB_REPOS_FIXTURE,
  readmes: GITHUB_READMES_FIXTURE,
};

let root: string;
let dir: string;
let client: FixtureGithubClient;

async function writeFixture(username: string, content: unknown) {
  await writeFile(
    join(dir, `${username}.json`),
    typeof content === 'string' ? content : JSON.stringify(content),
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'github-fixtures-'));
  dir = join(root, 'github');
  await mkdir(dir);
  client = new FixtureGithubClient(config, dir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('FixtureGithubClient', () => {
  it('serves the user from the fixture file', async () => {
    await writeFixture(GITHUB_USERNAME, FIXTURE);
    await expect(client.getUser(GITHUB_USERNAME)).resolves.toEqual(
      GITHUB_USER_FIXTURE,
    );
  });

  it('defaults a missing bio to null', async () => {
    await writeFixture('nobio', {
      user: { login: 'nobio', html_url: 'https://github.com/nobio' },
      repos: [],
    });
    await expect(client.getUser('nobio')).resolves.toEqual({
      login: 'nobio',
      html_url: 'https://github.com/nobio',
      bio: null,
    });
    await expect(client.listOwnerRepos('nobio')).resolves.toEqual([]);
    await expect(client.getReadme('nobio', 'x')).resolves.toBeNull();
  });

  it('lists repos most recently pushed first', async () => {
    await writeFixture(GITHUB_USERNAME, FIXTURE);
    const repos = await client.listOwnerRepos(GITHUB_USERNAME);
    expect(repos).toHaveLength(GITHUB_REPOS_FIXTURE.length);
    const pushed = repos.map((r) => r.pushed_at ?? '');
    expect(pushed).toEqual([...pushed].sort().reverse());
    expect(repos[0].name).toBe('bravo');
  });

  it('returns the README text, or null when the repo has none', async () => {
    await writeFixture(GITHUB_USERNAME, FIXTURE);
    await expect(client.getReadme(GITHUB_USERNAME, 'bravo')).resolves.toBe(
      GITHUB_READMES_FIXTURE.bravo,
    );
    await expect(
      client.getReadme(GITHUB_USERNAME, 'alpha'),
    ).resolves.toBeNull();
    await expect(
      client.getReadme(GITHUB_USERNAME, '__proto__'),
    ).resolves.toBeNull();
  });

  it('throws GithubNotFoundError for an unknown username', async () => {
    await expect(client.getUser('ghost')).rejects.toBeInstanceOf(
      GithubNotFoundError,
    );
    await expect(client.listOwnerRepos('ghost')).rejects.toBeInstanceOf(
      GithubNotFoundError,
    );
    await expect(client.getReadme('ghost', 'x')).rejects.toBeInstanceOf(
      GithubNotFoundError,
    );
  });

  it.each([
    ['not JSON', '{ nope'],
    ['a non-object', '[]'],
    ['no user', { repos: [] }],
    ['no repos', { user: GITHUB_USER_FIXTURE }],
    ['a repo without a name', { user: GITHUB_USER_FIXTURE, repos: [{}] }],
    [
      'a non-string README',
      { user: GITHUB_USER_FIXTURE, repos: [], readmes: { a: 1 } },
    ],
  ])(
    'throws GithubUnavailableError for a malformed fixture (%s)',
    async (_n, content) => {
      await writeFixture('broken', content);
      const error = await client.getUser('broken').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(GithubUnavailableError);
      expect((error as GithubUnavailableError).reason).toBe('invalid fixture');
    },
  );

  it('rejects invalid usernames and path traversal without reading outside the directory', async () => {
    // A valid fixture sits next to (outside) the fixtures dir.
    await writeFile(join(root, 'x.json'), JSON.stringify(FIXTURE));
    await writeFile(join(root, 'github.json'), JSON.stringify(FIXTURE));

    for (const name of [
      '../x',
      '..',
      'a/b',
      'a\\b',
      '/etc/passwd',
      '',
      '.',
      'x.json',
      'a'.repeat(40),
    ]) {
      await expect(client.getUser(name)).rejects.toBeInstanceOf(
        GithubNotFoundError,
      );
      await expect(client.listOwnerRepos(name)).rejects.toBeInstanceOf(
        GithubNotFoundError,
      );
      await expect(client.getReadme(name, 'bravo')).rejects.toBeInstanceOf(
        GithubNotFoundError,
      );
    }
  });

  it('never makes a network call', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await writeFixture(GITHUB_USERNAME, FIXTURE);
    await client.getUser(GITHUB_USERNAME);
    await client.listOwnerRepos(GITHUB_USERNAME);
    await client.getReadme(GITHUB_USERNAME, 'bravo');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  describe('with GithubProfileFetcher', () => {
    const server = setupServer();
    beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
    afterEach(() => server.resetHandlers());
    afterAll(() => server.close());

    let warnSpy: ReturnType<typeof jest.spyOn>;
    beforeEach(() => {
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => warnSpy.mockRestore());

    it('yields the same snapshot as the real client over the same data', async () => {
      await writeFixture(GITHUB_USERNAME, FIXTURE);
      server.use(...githubHandlers());

      const real = await new GithubProfileFetcher(
        new GithubClient(config),
      ).fetch(GITHUB_USERNAME);
      const fixture = await new GithubProfileFetcher(client).fetch(
        GITHUB_USERNAME,
      );

      expect(fixture.status).toBe('ok');
      expect(fixture.repos.length).toBeGreaterThan(0);
      expect(fixture.languages.length).toBeGreaterThan(0);
      expect({ ...fixture, fetchedAt: '' }).toEqual({
        ...real,
        fetchedAt: '',
      });
    });

    it('yields a not_found snapshot for an unknown user', async () => {
      server.use(http.all('*', () => HttpResponse.error()));
      const snapshot = await new GithubProfileFetcher(client).fetch('ghost');
      expect(snapshot.status).toBe('not_found');
    });
  });
});
