import { ApiProperty } from '@nestjs/swagger';
import type { CandidateSearchResult } from '@rag-ats/shared';
import { CandidateResponseDto } from './candidate-response.dto.js';
import { SearchSnippetResponseDto } from './search-snippet-response.dto.js';

export class CandidateSearchResultResponseDto implements CandidateSearchResult {
  @ApiProperty({ type: CandidateResponseDto })
  candidate: CandidateResponseDto;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1,
    example: 0.712,
    description:
      "The best chunk's cosine similarity; results are sorted by it, descending",
  })
  similarity: number;

  @ApiProperty({
    type: [SearchSnippetResponseDto],
    description: 'Up to 3 best-matching chunks, best first',
  })
  snippets: SearchSnippetResponseDto[];
}
