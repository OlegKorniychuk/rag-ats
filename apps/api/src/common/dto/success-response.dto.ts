import { ApiProperty } from '@nestjs/swagger';
import type { SuccessResponse } from '@rag-ats/shared';

export class SuccessResponseDto implements SuccessResponse {
  @ApiProperty({ enum: [true], example: true })
  success: true;
}
