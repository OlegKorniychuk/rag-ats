import { ApiProperty } from '@nestjs/swagger';
import type { RetrievedChunk } from '@rag-ats/shared';

export class RetrievedChunkResponseDto implements RetrievedChunk {
  @ApiProperty({ enum: ['cv', 'github'], example: 'cv' })
  source: 'cv' | 'github';

  @ApiProperty({
    example: 'Built and operated NestJS REST APIs backed by PostgreSQL',
    description: 'The chunk text, verbatim',
  })
  text: string;

  @ApiProperty({
    example: 0.62,
    description: 'Cosine similarity of the chunk to the criterion text',
  })
  similarity: number;
}
