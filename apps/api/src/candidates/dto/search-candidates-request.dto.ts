import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { SearchCandidatesRequest } from '@rag-ats/shared';

export class SearchCandidatesRequestDto implements SearchCandidatesRequest {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: 'backend engineer with Kafka and Kubernetes',
    description:
      'Natural-language description of the candidate you are looking for. Trimmed; 1-500 characters.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  query: string;
}
