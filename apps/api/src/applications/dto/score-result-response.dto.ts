import { ApiProperty } from '@nestjs/swagger';
import type { ScoreResult } from '@rag-ats/shared';
import { CriterionScoreResponseDto } from './criterion-score-response.dto.js';

export class ScoreResultResponseDto implements ScoreResult {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    example: 78,
    description: 'Importance-weighted mean of the criteria scores',
  })
  overall: number;

  @ApiProperty({
    example: 'Strong backend fit; limited evidence of cloud deployment.',
  })
  rationale: string;

  @ApiProperty({ type: () => [CriterionScoreResponseDto] })
  criteria: CriterionScoreResponseDto[];

  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'The CV the score was computed from',
  })
  cvDocumentId: string;

  @ApiProperty({ example: 'gpt-5-mini' })
  model: string;

  @ApiProperty({ enum: ['full_text'], example: 'full_text' })
  mode: 'full_text';

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  scoredAt: string;
}
