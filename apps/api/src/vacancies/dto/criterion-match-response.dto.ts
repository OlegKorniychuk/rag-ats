import { ApiProperty } from '@nestjs/swagger';
import type { CriterionImportance, CriterionMatch } from '@rag-ats/shared';

export class CriterionMatchResponseDto implements CriterionMatch {
  @ApiProperty({ example: 'c1' })
  criterionId: string;

  @ApiProperty({ example: 'Hands-on Kubernetes experience' })
  criterion: string;

  @ApiProperty({ enum: ['must', 'nice'], example: 'must' })
  importance: CriterionImportance;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 1,
    example: 0.612,
    description:
      "Best chunk similarity for this criterion; null when none of the candidate's chunks was retrieved for it",
  })
  similarity: number | null;

  @ApiProperty({ description: 'The similarity is at or above the match floor' })
  matched: boolean;
}
