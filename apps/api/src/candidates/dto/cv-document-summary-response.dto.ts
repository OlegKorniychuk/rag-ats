import { ApiProperty } from '@nestjs/swagger';
import type { CvDocumentSummary } from '@rag-ats/shared';

export class CvDocumentSummaryResponseDto implements CvDocumentSummary {
  @ApiProperty({
    format: 'uuid',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  })
  id: string;

  @ApiProperty({ example: 'jane-doe-cv.pdf' })
  filename: string;

  @ApiProperty({ example: 204800 })
  sizeBytes: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-01-15T09:30:00.000Z',
  })
  uploadedAt: string;
}
