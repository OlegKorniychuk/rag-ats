import { ApiProperty } from '@nestjs/swagger';
import type { PublicVacancyResponse, VacancyStatus } from '@rag-ats/shared';

export class PublicVacancyResponseDto implements PublicVacancyResponse {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  title: string;

  @ApiProperty({
    example: '5+ years with Node.js and PostgreSQL, strong TypeScript skills',
  })
  requirements: string;

  @ApiProperty({ enum: ['open', 'closed'], example: 'open' })
  status: VacancyStatus;
}
