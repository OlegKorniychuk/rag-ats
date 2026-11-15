import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { EnvConfig } from '../config/env.config.js';
import {
  GithubClient,
  GithubNotFoundError,
  GithubUnavailableError,
  type GithubRepoResponse,
  type GithubUserResponse,
} from './github-client.js';
import { USERNAME_PATTERN } from './github-username.js';

/**
 * Shape of `<dir>/<username>.json`: the subset of the GitHub API responses the
 * app reads, plus the raw README text per repo name.
 */
export interface GithubFixture {
  user: GithubUserResponse;
  repos: GithubRepoResponse[];
  /** Raw README text by repo name; a repo without an entry has no README. */
  readmes: Record<string, string>;
}

/**
 * Serves GitHub data from fixture files and never touches the network. Dev and
 * seed only (`GITHUB_FIXTURES_DIR`).
 *
 * The file is looked up by the exact username (case-sensitive): fixture files
 * must be named like the username in the candidate's GitHub URL.
 */
export class FixtureGithubClient extends GithubClient {
  private readonly dir: string;

  constructor(config: EnvConfig, dir: string) {
    super(config);
    this.dir = resolve(dir);
  }

  override async getUser(username: string): Promise<GithubUserResponse> {
    return (await this.load(username)).user;
  }

  /** Like the real call: most recently pushed first. */
  override async listOwnerRepos(
    username: string,
  ): Promise<GithubRepoResponse[]> {
    const { repos } = await this.load(username);
    return [...repos].sort((a, b) =>
      (b.pushed_at ?? '').localeCompare(a.pushed_at ?? ''),
    );
  }

  override async getReadme(
    username: string,
    repo: string,
  ): Promise<string | null> {
    const { readmes } = await this.load(username);
    return Object.prototype.hasOwnProperty.call(readmes, repo)
      ? readmes[repo]
      : null;
  }

  private async load(username: string): Promise<GithubFixture> {
    // Anything that is not a valid GitHub username cannot exist, and must
    // never reach the file system.
    if (!USERNAME_PATTERN.test(username)) {
      throw new GithubNotFoundError(`/users/${encodeURIComponent(username)}`);
    }
    const file = resolve(this.dir, `${username}.json`);
    if (!file.startsWith(this.dir + sep)) {
      throw new GithubNotFoundError(`/users/${username}`);
    }

    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new GithubNotFoundError(`/users/${username}`);
      }
      throw new GithubUnavailableError('unreadable fixture');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new GithubUnavailableError('invalid fixture');
    }
    return toFixture(parsed);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toFixture(value: unknown): GithubFixture {
  if (
    !isRecord(value) ||
    !isRecord(value.user) ||
    typeof value.user.login !== 'string' ||
    typeof value.user.html_url !== 'string' ||
    !Array.isArray(value.repos) ||
    !value.repos.every(
      (repo) =>
        isRecord(repo) &&
        typeof repo.name === 'string' &&
        typeof repo.html_url === 'string' &&
        typeof repo.stargazers_count === 'number',
    ) ||
    (value.readmes !== undefined &&
      (!isRecord(value.readmes) ||
        !Object.values(value.readmes).every((v) => typeof v === 'string')))
  ) {
    throw new GithubUnavailableError('invalid fixture');
  }
  const user = value.user;
  return {
    user: {
      login: user.login as string,
      html_url: user.html_url as string,
      bio: typeof user.bio === 'string' ? user.bio : null,
    },
    repos: value.repos as GithubRepoResponse[],
    readmes: (value.readmes ?? {}) as Record<string, string>,
  };
}
