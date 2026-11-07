import { ApiProperty } from '@nestjs/swagger';
import type { SearchSnippet } from '@rag-ats/shared';

export class SearchSnippetResponseDto implements SearchSnippet {
  @ApiProperty({ enum: ['cv', 'github'], example: 'cv' })
  source: 'cv' | 'github';

  @ApiProperty({
    description: 'The matching chunk, verbatim from its source',
    example: 'Ran Kubernetes clusters on AWS, managed with Terraform',
  })
  text: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 1,
    example: 0.712,
    description: "This chunk's cosine similarity to the query",
  })
  similarity: number;
}
