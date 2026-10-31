import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { AddApplicationRequest } from '@rag-ats/shared';

export class AddApplicationDto implements AddApplicationRequest {
  @ApiProperty({
    format: 'uuid',
    example: '7b6c2e1a-4f3d-4a2b-9c1e-8f7a6d5c4b3a',
    description: 'The pool candidate to add to the vacancy',
  })
  @IsUUID()
  candidateId: string;
}
