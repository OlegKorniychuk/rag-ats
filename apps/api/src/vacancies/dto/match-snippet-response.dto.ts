import { ApiProperty } from '@nestjs/swagger';
import type { MatchSnippet } from '@rag-ats/shared';
import { SearchSnippetResponseDto } from '../../candidates/dto/search-snippet-response.dto.js';

export class MatchSnippetResponseDto
  extends SearchSnippetResponseDto
  implements MatchSnippet
{
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'c1',
    description:
      'The criterion this chunk was retrieved for; null in `whole_text` mode',
  })
  criterionId: string | null;
}
