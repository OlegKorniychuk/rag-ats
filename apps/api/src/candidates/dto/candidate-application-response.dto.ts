import { ApiProperty } from '@nestjs/swagger';
import type {
  ApplicationSource,
  ApplicationStage,
  CandidateApplicationResponse,
  VacancyStatus,
} from '@rag-ats/shared';
import { ApplicationScoreResponseDto } from '../../applications/dto/application-score-response.dto.js';
import {
  applicationSourceEnum,
  applicationStageEnum,
  vacancyStatusEnum,
} from '../../db/schema.js';

export class CandidateApplicationResponseDto implements CandidateApplicationResponse {
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

  @ApiProperty({ example: 'Senior Backend Engineer' })
  vacancyTitle: string;

  @ApiProperty({ enum: vacancyStatusEnum.enumValues, example: 'open' })
  vacancyStatus: VacancyStatus;

  @ApiProperty({
    enum: applicationStageEnum.enumValues,
    example: 'applied',
  })
  stage: ApplicationStage;

  @ApiProperty({
    enum: applicationSourceEnum.enumValues,
    example: 'added',
    description:
      'Whether the candidate applied themselves or a recruiter added them from the pool',
  })
  source: ApplicationSource;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  createdAt: string;

  @ApiProperty({ type: () => ApplicationScoreResponseDto })
  score: ApplicationScoreResponseDto;
}
