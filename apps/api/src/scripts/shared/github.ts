import type { GithubProfileFetcher } from '../../github/github-profile-fetcher.js';
import type { GithubSnapshot } from '../../github/github-snapshot.js';
import { parseGithubUsername } from '../../github/github-username.js';
import type { GithubEvalStatus } from '../parse-eval/result.js';

export async function fetchGithub(
  fetcher: GithubProfileFetcher,
  githubUrl: string | null,
): Promise<{ status: GithubEvalStatus; snapshot: GithubSnapshot | null }> {
  if (githubUrl === null) return { status: 'none', snapshot: null };
  const username = parseGithubUsername(githubUrl);
  if (username === null) return { status: 'invalid_url', snapshot: null };
  const snapshot = await fetcher.fetch(username);
  return { status: snapshot.status, snapshot };
}
