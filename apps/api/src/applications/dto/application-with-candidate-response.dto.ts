import { ApiProperty } from '@nestjs/swagger';
import { CandidateResponseDto } from '../../candidates/dto/candidate-response.dto.js';
import type { ApplicationWithCandidate } from '../../db/repositories/applications.repository.js';
import { ApplicationResponseDto } from './application-response.dto.js';

export class ApplicationWithCandidateResponseDto
  extends ApplicationResponseDto
  implements ApplicationWithCandidate
{
  @ApiProperty({ type: () => CandidateResponseDto })
  candidate: CandidateResponseDto;
}
