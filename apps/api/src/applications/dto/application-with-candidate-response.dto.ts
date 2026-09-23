import { ApiProperty } from '@nestjs/swagger';
import type { ApplicationWithCandidateResponse } from '@rag-ats/shared';
import { CandidateResponseDto } from '../../candidates/dto/candidate-response.dto.js';
import { ApplicationResponseDto } from './application-response.dto.js';

export class ApplicationWithCandidateResponseDto
  extends ApplicationResponseDto
  implements ApplicationWithCandidateResponse
{
  @ApiProperty({ type: () => CandidateResponseDto })
  candidate: CandidateResponseDto;
}
