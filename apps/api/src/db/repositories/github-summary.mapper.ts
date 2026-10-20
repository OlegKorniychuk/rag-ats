import type { GithubSummary } from '@rag-ats/shared';
import {
  toGithubSummary,
  type GithubSnapshot,
} from '../../github/github-snapshot.js';

/**
 * Replaces the raw `githubSnapshot` of a loaded candidate with the API-shaped
 * `github` summary (null when never fetched), so the internal bio and README
 * excerpts cannot reach the HTTP layer.
 */
export function withGithub<T extends { githubSnapshot: GithubSnapshot | null }>(
  row: T,
): Omit<T, 'githubSnapshot'> & { github: GithubSummary | null } {
  const { githubSnapshot, ...rest } = row;
  return {
    ...rest,
    github: githubSnapshot ? toGithubSummary(githubSnapshot) : null,
  };
}
