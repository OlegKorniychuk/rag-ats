import type { GithubRepoSummary, GithubSummary } from '@rag-ats/shared';

/** A repo as stored: the public summary plus text used only by the LLM/scoring. */
export type GithubRepoSnapshot = GithubRepoSummary & {
  /** Sanitised, truncated README text; internal, never in API responses. */
  readmeExcerpt: string | null;
};

/** What is persisted in `candidates.github_snapshot` (jsonb). */
export type GithubSnapshot = Omit<GithubSummary, 'repos'> & {
  /** Profile bio; internal, never in API responses. */
  bio: string | null;
  repos: GithubRepoSnapshot[];
};

/** Maps the stored snapshot to the API shape, dropping internal-only fields. */
export function toGithubSummary(snapshot: GithubSnapshot): GithubSummary {
  return {
    username: snapshot.username,
    profileUrl: snapshot.profileUrl,
    status: snapshot.status,
    fetchedAt: snapshot.fetchedAt,
    repos: snapshot.repos.map((repo) => ({
      name: repo.name,
      url: repo.url,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      topics: [...repo.topics],
      pushedAt: repo.pushedAt,
    })),
    languages: snapshot.languages.map((language) => ({
      name: language.name,
      repoCount: language.repoCount,
    })),
  };
}
