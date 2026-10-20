import { ApiProperty } from '@nestjs/swagger';
import type { GithubStatus, GithubSummary } from '@rag-ats/shared';
import { GithubLanguageCountResponseDto } from './github-language-count-response.dto.js';
import { GithubRepoSummaryResponseDto } from './github-repo-summary-response.dto.js';

export const GITHUB_STATUSES = [
  'ok',
  'not_found',
  'unavailable',
] as const satisfies readonly GithubStatus[];

export class GithubSummaryResponseDto implements GithubSummary {
  @ApiProperty({ example: 'janedoe' })
  username: string;

  @ApiProperty({ format: 'uri', example: 'https://github.com/janedoe' })
  profileUrl: string;

  @ApiProperty({
    enum: GITHUB_STATUSES,
    enumName: 'GithubStatus',
    example: 'ok',
    description:
      'ok, or why no data is available (profile not found / GitHub unreachable)',
  })
  status: GithubStatus;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  fetchedAt: string;

  @ApiProperty({ type: [GithubRepoSummaryResponseDto] })
  repos: GithubRepoSummaryResponseDto[];

  @ApiProperty({
    type: [GithubLanguageCountResponseDto],
    description:
      'Primary-language counts across owned, non-fork repos, most used first',
  })
  languages: GithubLanguageCountResponseDto[];
}
