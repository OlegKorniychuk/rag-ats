import { Injectable } from '@nestjs/common';
import { EnvConfig } from '../config/env.config.js';

/** Constant on purpose: the host is never derived from user input (SSRF). */
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_REQUEST_TIMEOUT_MS = 10_000;

export interface GithubUserResponse {
  login: string;
  html_url: string;
  bio: string | null;
}

export interface GithubRepoResponse {
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics?: string[];
  pushed_at: string | null;
  created_at?: string | null;
  fork: boolean;
  archived: boolean;
}

/** The requested resource does not exist (HTTP 404). */
export class GithubNotFoundError extends Error {
  constructor(readonly resource: string) {
    super(`GitHub resource not found: ${resource}`);
    this.name = 'GithubNotFoundError';
  }
}

/**
 * GitHub could not serve the request: rate limited (403/429), 5xx, other
 * non-2xx, timeout, network failure or an unreadable body. `reason` is a short
 * safe description (never contains the token or response bodies).
 */
export class GithubUnavailableError extends Error {
  constructor(
    readonly reason: string,
    readonly status?: number,
  ) {
    super(`GitHub unavailable: ${reason}`);
    this.name = 'GithubUnavailableError';
  }
}

/** Thin typed wrapper over the GitHub REST API (public, read-only endpoints). */
@Injectable()
export class GithubClient {
  private readonly token: string | undefined;
  /** Per-request timeout; overridable so tests can use a short one. */
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS;

  constructor(config: EnvConfig) {
    this.token = config.GITHUB_TOKEN?.trim() || undefined;
  }

  async getUser(username: string): Promise<GithubUserResponse> {
    const user = await this.getJson<Partial<GithubUserResponse>>(
      `/users/${encodeURIComponent(username)}`,
    );
    if (
      typeof user !== 'object' ||
      user === null ||
      typeof user.login !== 'string' ||
      typeof user.html_url !== 'string'
    ) {
      throw new GithubUnavailableError('unexpected user response');
    }
    return {
      login: user.login,
      html_url: user.html_url,
      bio: typeof user.bio === 'string' ? user.bio : null,
    };
  }

  /** First page (up to 100) of repos owned by the user, most recently pushed first. */
  async listOwnerRepos(username: string): Promise<GithubRepoResponse[]> {
    const repos = await this.getJson<GithubRepoResponse[]>(
      `/users/${encodeURIComponent(username)}/repos?type=owner&sort=pushed&per_page=100`,
    );
    if (!Array.isArray(repos)) {
      throw new GithubUnavailableError('unexpected repos response');
    }
    return repos;
  }

  /** Raw README text, or null when the repo has none (404). */
  async getReadme(username: string, repo: string): Promise<string | null> {
    const path = `/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/readme`;
    try {
      const response = await this.request(path, 'application/vnd.github.raw');
      return await response.text();
    } catch (error) {
      if (error instanceof GithubNotFoundError) return null;
      if (error instanceof GithubUnavailableError) throw error;
      throw new GithubUnavailableError('unreadable response body');
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path, 'application/vnd.github+json');
    try {
      return (await response.json()) as T;
    } catch {
      throw new GithubUnavailableError('invalid JSON');
    }
  }

  private async request(path: string, accept: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rag-ats',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${GITHUB_API_BASE}${path}`, { headers, signal });
    } catch {
      // Deliberately drop the original error: only a coarse reason is kept.
      throw new GithubUnavailableError(
        signal.aborted ? 'timeout' : 'network error',
      );
    }

    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      throw new GithubNotFoundError(path.split('?')[0]);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GithubUnavailableError(
        `HTTP ${response.status}`,
        response.status,
      );
    }
    return response;
  }
}
