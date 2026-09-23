import { ApiProperty } from '@nestjs/swagger';
import type { PublicVacancy } from '../apply.service.js';

export class PublicVacancyResponseDto implements PublicVacancy {
  @ApiProperty({ example: 'Senior Backend Engineer' })
  title: string;

  @ApiProperty({
    example: '5+ years with Node.js and PostgreSQL, strong TypeScript skills',
  })
  requirements: string;

  @ApiProperty({ enum: ['open', 'closed'], example: 'open' })
  status: 'open' | 'closed';
}
