import { ApiProperty } from '@nestjs/swagger';
import type { CriterionImportance, CriterionScore } from '@rag-ats/shared';
import { ScoreQuoteResponseDto } from './score-quote-response.dto.js';

export class CriterionScoreResponseDto implements CriterionScore {
  @ApiProperty({ example: 'c1' })
  criterionId: string;

  @ApiProperty({ example: '3+ years of Node.js backend experience' })
  criterion: string;

  @ApiProperty({ enum: ['must', 'nice'], example: 'must' })
  importance: CriterionImportance;

  @ApiProperty({ minimum: 0, maximum: 100, example: 85 })
  score: number;

  @ApiProperty({
    example: 'Several years of NestJS work are described in the CV.',
  })
  reasoning: string;

  @ApiProperty({ type: () => [ScoreQuoteResponseDto] })
  quotes: ScoreQuoteResponseDto[];
}
