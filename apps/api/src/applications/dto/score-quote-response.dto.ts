import { ApiProperty } from '@nestjs/swagger';
import type { ScoreQuote } from '@rag-ats/shared';

export class ScoreQuoteResponseDto implements ScoreQuote {
  @ApiProperty({
    enum: ['cv', 'github'],
    example: 'cv',
    description: 'Where the quote was found',
  })
  source: 'cv' | 'github';

  @ApiProperty({
    example: 'Built and operated NestJS REST APIs backed by PostgreSQL',
    description: 'Verbatim text from the source, checked server-side',
  })
  text: string;
}
