import { ApiProperty } from '@nestjs/swagger';
import type { GithubRepoSummary } from '@rag-ats/shared';

export class GithubRepoSummaryResponseDto implements GithubRepoSummary {
  @ApiProperty({ example: 'nest-api-starter' })
  name: string;

  @ApiProperty({
    format: 'uri',
    example: 'https://github.com/janedoe/nest-api-starter',
  })
  url: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Opinionated NestJS starter',
  })
  description: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'TypeScript' })
  language: string | null;

  @ApiProperty({ example: 42 })
  stars: number;

  @ApiProperty({ type: [String], example: ['nestjs', 'postgres'] })
  topics: string[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-10T12:00:00.000Z',
  })
  pushedAt: string;
}
