import { ApiProperty } from '@nestjs/swagger';
import type { ApplicationResponse, ApplicationStage } from '@rag-ats/shared';
import { applicationStageEnum } from '../../db/schema.js';

export class ApplicationResponseDto implements ApplicationResponse {
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
  stage: ApplicationStage;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  createdAt: string;
}
