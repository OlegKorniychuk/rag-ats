import { ApiProperty } from '@nestjs/swagger';
import type { VacancyMatch } from '@rag-ats/shared';
import { CandidateResponseDto } from '../../candidates/dto/candidate-response.dto.js';
import { CriterionMatchResponseDto } from './criterion-match-response.dto.js';
import { MatchSnippetResponseDto } from './match-snippet-response.dto.js';

export class VacancyMatchResponseDto implements VacancyMatch {
  @ApiProperty({ type: CandidateResponseDto })
  candidate: CandidateResponseDto;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1,
    example: 0.534,
    description:
      'Ranking score: weighted criterion coverage (`criteria`) or the best chunk similarity (`whole_text`)',
  })
  score: number;

  @ApiProperty({
    type: [CriterionMatchResponseDto],
    description:
      'Every vacancy criterion, must first (`criteria` mode); empty in `whole_text` mode',
  })
  criteria: CriterionMatchResponseDto[];

  @ApiProperty({
    type: [MatchSnippetResponseDto],
    description: 'Up to 3 best-matching chunks, best first',
  })
  snippets: MatchSnippetResponseDto[];
}
