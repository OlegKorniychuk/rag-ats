import { Module } from '@nestjs/common';
import { GithubClient } from './github-client.js';
import { GithubProfileFetcher } from './github-profile-fetcher.js';

@Module({
  providers: [GithubClient, GithubProfileFetcher],
  exports: [GithubClient, GithubProfileFetcher],
})
export class GithubModule {}
