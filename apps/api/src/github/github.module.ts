import { Logger, Module } from '@nestjs/common';
import { EnvConfig } from '../config/env.config.js';
import { FixtureGithubClient } from './fixture-github-client.js';
import { GithubClient } from './github-client.js';
import { GithubProfileFetcher } from './github-profile-fetcher.js';

/**
 * The real client, or a fixture-backed one when `GITHUB_FIXTURES_DIR` is set
 * (dev and seed only: refused in production).
 */
export function createGithubClient(config: EnvConfig): GithubClient {
  const dir = config.GITHUB_FIXTURES_DIR?.trim();
  if (!dir) return new GithubClient(config);

  if (config.NODE_ENV === 'production') {
    throw new Error(
      'GITHUB_FIXTURES_DIR must not be set when NODE_ENV=production',
    );
  }
  new Logger(GithubModule.name).warn(
    `GitHub fixtures active: serving profiles from ${dir}, no GitHub API calls`,
  );
  return new FixtureGithubClient(config, dir);
}

@Module({
  providers: [
    {
      provide: GithubClient,
      inject: [EnvConfig],
      useFactory: createGithubClient,
    },
    GithubProfileFetcher,
  ],
  exports: [GithubClient, GithubProfileFetcher],
})
export class GithubModule {}
