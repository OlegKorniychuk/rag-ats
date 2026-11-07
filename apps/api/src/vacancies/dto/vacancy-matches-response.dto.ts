import { ApiProperty } from '@nestjs/swagger';
import type { MatchMode, VacancyMatchesResponse } from '@rag-ats/shared';
import { VacancyMatchResponseDto } from './vacancy-match-response.dto.js';

export class VacancyMatchesResponseDto implements VacancyMatchesResponse {
  @ApiProperty({ enum: ['criteria', 'whole_text'], example: 'criteria' })
  mode: MatchMode;

  @ApiProperty({
    type: [VacancyMatchResponseDto],
    description:
      'Up to 10 pool candidates, best first; candidates already on the vacancy are excluded',
  })
  matches: VacancyMatchResponseDto[];
}
