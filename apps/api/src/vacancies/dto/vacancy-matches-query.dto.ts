import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { MatchMode } from '@rag-ats/shared';

export class VacancyMatchesQueryDto {
  @ApiPropertyOptional({
    enum: ['criteria', 'whole_text'],
    default: 'criteria',
    description:
      '`criteria` retrieves per extracted criterion and ranks by weighted coverage. `whole_text` embeds title and requirements as one query (a diagnostic mode for evaluation).',
  })
  @IsOptional()
  @IsIn(['criteria', 'whole_text'])
  mode?: MatchMode;
}
