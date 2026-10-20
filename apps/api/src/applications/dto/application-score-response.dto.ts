import { ApiProperty } from '@nestjs/swagger';
import type { ApplicationScore, ScoreStatus } from '@rag-ats/shared';
import { scoreStatusEnum } from '../../db/schema.js';
import { ScoreResultResponseDto } from './score-result-response.dto.js';

export class ApplicationScoreResponseDto implements ApplicationScore {
  @ApiProperty({
    enum: scoreStatusEnum.enumValues,
    example: 'scored',
    description: 'Progress of the background scoring',
  })
  status: ScoreStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Short, safe reason when status is failed; otherwise null',
  })
  error: string | null;

  @ApiProperty({
    example: false,
    description: "True while the candidate's CV is not yet parsed",
  })
  waitingForParse: boolean;

  @ApiProperty({
    example: false,
    description:
      "True when result was not computed from the candidate's current CV or the vacancy's current criteria",
  })
  stale: boolean;

  @ApiProperty({
    type: () => ScoreResultResponseDto,
    nullable: true,
    description: 'The last good score; kept while a rescore is pending',
  })
  result: ScoreResultResponseDto | null;
}
