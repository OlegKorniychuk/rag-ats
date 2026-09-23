import { ApiProperty } from '@nestjs/swagger';
import type { Vacancy } from '../../db/repositories/vacancies.repository.js';

export class VacancyResponseDto implements Vacancy {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '9c858901-8a57-4791-81fe-4c455b099bc9',
  })
  recruiterId: string;

  @ApiProperty({ example: 'Senior Backend Engineer' })
  title: string;

  @ApiProperty({
    example: '5+ years with Node.js and PostgreSQL, strong TypeScript skills',
  })
  requirements: string;

  @ApiProperty({ example: 'V1StGXR8_Z5jdHi6B-myT' })
  applyToken: string;

  @ApiProperty({ enum: ['open', 'closed'], example: 'open' })
  status: 'open' | 'closed';

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  createdAt: Date;
}
