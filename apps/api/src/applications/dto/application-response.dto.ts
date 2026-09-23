import { ApiProperty } from '@nestjs/swagger';
import { applicationStageEnum } from '../../db/schema.js';
import type { Application } from '../../db/repositories/applications.repository.js';

export class ApplicationResponseDto implements Application {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({
    format: 'uuid',
    example: '9c858901-8a57-4791-81fe-4c455b099bc9',
  })
  vacancyId: string;

  @ApiProperty({
    format: 'uuid',
    example: '7b6c2e1a-4f3d-4a2b-9c1e-8f7a6d5c4b3a',
  })
  candidateId: string;

  @ApiProperty({
    enum: applicationStageEnum.enumValues,
    example: 'applied',
  })
  stage: (typeof applicationStageEnum.enumValues)[number];

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  createdAt: Date;
}
