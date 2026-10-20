import { Injectable, Logger } from '@nestjs/common';
import {
  GithubClient,
  GithubNotFoundError,
  GithubUnavailableError,
  type GithubRepoResponse,
} from './github-client.js';
import type { GithubRepoSnapshot, GithubSnapshot } from './github-snapshot.js';

export const MAX_REPOS = 6;
export const README_REPO_COUNT = 3;
export const README_MAX_CHARS = 3_000;

/**
 * Builds a candidate's GitHub snapshot. Used as a plain class token, so
 * another implementation (e.g. a fixture-backed one for the synthetic seed)
 * can replace it with `{ provide: GithubProfileFetcher, useClass: Fixture }`.
 */
@Injectable()
export class GithubProfileFetcher {
  private readonly logger = new Logger(GithubProfileFetcher.name);

  constructor(private readonly client: GithubClient) {}

  /** Never throws: failures become a `not_found` / `unavailable` snapshot. */
  async fetch(username: string): Promise<GithubSnapshot> {
    try {
      const user = await this.client.getUser(username);
      const owned = (await this.client.listOwnerRepos(username)).filter(
        (repo) => !repo.fork,
      );

      const selected = selectRepos(owned);
      const readmes = await Promise.all(
        selected.map((repo, index) =>
          index < README_REPO_COUNT
            ? this.fetchReadmeExcerpt(username, repo.name)
            : Promise.resolve(null),
        ),
      );

      return {
        username: user.login,
        profileUrl: user.html_url,
        status: 'ok',
        fetchedAt: new Date().toISOString(),
        bio: user.bio,
        repos: selected.map((repo, index) =>
          toRepoSnapshot(repo, readmes[index]),
        ),
        languages: aggregateLanguages(owned),
      };
    } catch (error) {
      return this.failedSnapshot(username, error);
    }
  }

  private async fetchReadmeExcerpt(
    username: string,
    repo: string,
  ): Promise<string | null> {
    try {
      const raw = await this.client.getReadme(username, repo);
      if (raw === null) return null;
      return cleanReadme(raw) || null;
    } catch (error) {
      // A README problem must not fail the whole fetch.
      this.logger.warn(
        `README fetch failed for ${username}/${repo}: ${describe(error)}`,
      );
      return null;
    }
  }

  private failedSnapshot(username: string, error: unknown): GithubSnapshot {
    const status =
      error instanceof GithubNotFoundError ? 'not_found' : 'unavailable';
    this.logger.warn(
      `GitHub fetch for ${username} ended as ${status}: ${describe(error)}`,
    );
    return {
      username,
      profileUrl: `https://github.com/${username}`,
      status,
      fetchedAt: new Date().toISOString(),
      bio: null,
      repos: [],
      languages: [],
    };
  }
}

/** Safe, token-free description of a failure for logs. */
function describe(error: unknown): string {
  if (error instanceof GithubNotFoundError) return 'not found';
  if (error instanceof GithubUnavailableError) return error.reason;
  return 'unexpected error';
}

function pushedAt(repo: GithubRepoResponse): string {
  return repo.pushed_at ?? repo.created_at ?? '';
}

/** Non-fork, non-archived repos: most starred first, then most recently pushed. */
function selectRepos(owned: GithubRepoResponse[]): GithubRepoResponse[] {
  return owned
    .filter((repo) => !repo.archived)
    .sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        pushedAt(b).localeCompare(pushedAt(a)),
    )
    .slice(0, MAX_REPOS);
}

/**
 * Primary-language counts over all owned non-fork repos. Archived repos are
 * included: they still show what the candidate has written code in.
 */
function aggregateLanguages(
  owned: GithubRepoResponse[],
): { name: string; repoCount: number }[] {
  const counts = new Map<string, number>();
  for (const repo of owned) {
    if (!repo.language) continue;
    counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, repoCount]) => ({ name, repoCount }))
    .sort((a, b) => b.repoCount - a.repoCount || a.name.localeCompare(b.name));
}

function toRepoSnapshot(
  repo: GithubRepoResponse,
  readmeExcerpt: string | null,
): GithubRepoSnapshot {
  return {
    name: repo.name,
    url: repo.html_url,
    description: repo.description ?? null,
    language: repo.language ?? null,
    stars: repo.stargazers_count,
    topics: repo.topics ?? [],
    pushedAt: pushedAt(repo),
    readmeExcerpt,
  };
}

/**
 * Reduces a README to plain text for the LLM: drops images and badge links,
 * HTML (tags, comments, script/style bodies), collapses whitespace and caps
 * the length.
 */
export function cleanReadme(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g, ' ') // [![alt](img)](link)
    .replace(/\[\s*!\[[^\]]*\]\[[^\]]*\]\s*\]\([^)]*\)/g, ' ') // [![alt][ref]](link)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // ![alt](img)
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ') // ![alt][ref]
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, README_MAX_CHARS)
    .trim();
}
