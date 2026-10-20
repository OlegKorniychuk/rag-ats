import { ApiProperty } from '@nestjs/swagger';

export class GithubLanguageCountResponseDto {
  @ApiProperty({ example: 'TypeScript' })
  name: string;

  @ApiProperty({ example: 5 })
  repoCount: number;
}
